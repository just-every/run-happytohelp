import { GoogleGenAI, FunctionCallingConfigMode, Modality, MediaResolution, } from '@google/genai/web';
import { v4 as uuidv4 } from 'uuid';
import { BaseModelProvider } from './base_provider.js';
import { costTracker } from '../utils/cost_tracker.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';
import { isPaused } from '../utils/pause_controller.js';
import { appendMessageWithImage, normalizeImageDataUrl } from '../utils/image_utils.js';
import { chooseImageDetailFromInput, mapGeminiMediaResolution } from '../utils/image_detail.js';
import { usesCurrentGeminiGenerateContentContract } from './gemini_model_contract.js';
import { hasEventHandler } from '../utils/event_controller.js';
import { truncateLargeValues } from '../utils/truncate_utils.js';
import { findModel } from '../data/model_data.js';
import { normalizeGeminiUsage } from '../utils/provider_usage.js';
async function resolveAsyncEnums(params) {
    if (!params || typeof params !== 'object') {
        return params;
    }
    const resolved = { ...params };
    if (resolved.properties) {
        const resolvedProps = {};
        for (const [key, value] of Object.entries(resolved.properties)) {
            if (value && typeof value === 'object') {
                const propCopy = { ...value };
                if (typeof propCopy.enum === 'function') {
                    try {
                        const enumValue = await propCopy.enum();
                        if (Array.isArray(enumValue) && enumValue.length > 0) {
                            propCopy.enum = enumValue;
                        }
                        else {
                            delete propCopy.enum;
                        }
                    }
                    catch {
                        delete propCopy.enum;
                    }
                }
                resolvedProps[key] = await resolveAsyncEnums(propCopy);
            }
            else {
                resolvedProps[key] = value;
            }
        }
        resolved.properties = resolvedProps;
    }
    return resolved;
}
async function convertToGeminiFunctionDeclarations(tools) {
    const declarations = await Promise.all(tools.map(async (tool) => {
        if (tool.definition.function.name === 'google_web_search' ||
            tool.definition.function.name === 'code_execution') {
            return null;
        }
        const resolvedParams = await resolveAsyncEnums(tool.definition?.function?.parameters);
        return {
            name: tool.definition.function.name,
            description: tool.definition.function.description,
            parametersJsonSchema: resolvedParams,
        };
    }));
    return declarations.filter(Boolean);
}
export function getImageMimeType(imageData) {
    if (imageData.includes('data:image/png'))
        return 'image/png';
    if (imageData.includes('data:image/jpeg'))
        return 'image/jpeg';
    if (imageData.includes('data:image/gif'))
        return 'image/gif';
    if (imageData.includes('data:image/webp'))
        return 'image/webp';
    return 'image/png';
}
function inferImageMimeTypeFromUrl(src) {
    try {
        const url = new URL(src);
        const path = url.pathname.toLowerCase();
        if (path.endsWith('.png'))
            return 'image/png';
        if (path.endsWith('.jpg') || path.endsWith('.jpeg'))
            return 'image/jpeg';
        if (path.endsWith('.webp'))
            return 'image/webp';
        if (path.endsWith('.gif'))
            return 'image/gif';
        if (path.endsWith('.bmp'))
            return 'image/bmp';
        if (path.endsWith('.tif') || path.endsWith('.tiff'))
            return 'image/tiff';
        if (path.endsWith('.svg'))
            return 'image/svg+xml';
    }
    catch {
    }
    const lower = src.toLowerCase();
    if (lower.includes('.png'))
        return 'image/png';
    if (lower.includes('.jpg') || lower.includes('.jpeg'))
        return 'image/jpeg';
    if (lower.includes('.webp'))
        return 'image/webp';
    if (lower.includes('.gif'))
        return 'image/gif';
    if (lower.includes('.bmp'))
        return 'image/bmp';
    if (lower.includes('.tif') || lower.includes('.tiff'))
        return 'image/tiff';
    if (lower.includes('.svg'))
        return 'image/svg+xml';
    return 'image/jpeg';
}
function parseImageDataUri(source) {
    const match = /^data:(image\/[^;,]+);base64,([\s\S]+)$/i.exec(source);
    if (!match)
        return null;
    return { mimeType: match[1].toLowerCase(), data: match[2] };
}
async function loadVideoSourceImage(source, signal) {
    const inline = parseImageDataUri(source);
    if (inline) {
        return { imageBytes: inline.data, mimeType: inline.mimeType };
    }
    if (!source.startsWith('http://') && !source.startsWith('https://')) {
        throw new Error('Gemini video generation expects source_image to be an http(s) URL or data:image base64 URI.');
    }
    const response = await fetch(source, { signal });
    if (!response.ok) {
        throw new Error(`Failed to download Gemini video source image: ${response.status} ${response.statusText}`);
    }
    const mimeType = response.headers.get('content-type')?.split(';')[0] || inferImageMimeTypeFromUrl(source);
    const imageBytes = Buffer.from(await response.arrayBuffer()).toString('base64');
    return { imageBytes, mimeType };
}
function waitForGeminiVideoPoll(milliseconds, signal) {
    if (signal?.aborted) {
        return Promise.reject(signal.reason || new Error('Gemini video generation aborted.'));
    }
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, milliseconds);
        const onAbort = () => {
            clearTimeout(timeout);
            reject(signal?.reason || new Error('Gemini video generation aborted.'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
function findInteractionVideo(response) {
    const normalize = (candidate) => {
        if (!candidate || typeof candidate !== 'object')
            return null;
        const data = typeof candidate.data === 'string' ? candidate.data : undefined;
        const uri = typeof candidate.uri === 'string' ? candidate.uri : undefined;
        const mimeType = candidate.mime_type || candidate.mimeType || 'video/mp4';
        if ((candidate.type === 'video' || data || uri) && (data || uri)) {
            return { data, uri, mimeType };
        }
        return null;
    };
    const direct = normalize(response?.output_video) || normalize(response?.outputVideo);
    if (direct)
        return direct;
    for (const output of response?.outputs || []) {
        const found = normalize(output);
        if (found)
            return found;
    }
    for (const step of response?.steps || []) {
        if (step?.type !== 'model_output')
            continue;
        for (const content of step?.content || []) {
            const found = normalize(content);
            if (found)
                return found;
        }
    }
    return null;
}
function interactionTokenCountByModality(values, modality) {
    if (!Array.isArray(values))
        return 0;
    return values.reduce((total, item) => {
        if (item?.modality !== modality)
            return total;
        const count = item?.tokens ?? item?.token_count ?? item?.tokenCount ?? 0;
        return total + (typeof count === 'number' ? count : 0);
    }, 0);
}
function veoVideoRate(model, resolution) {
    const modelEntry = findModel(model);
    const rates = modelEntry?.cost?.per_second_by_resolution;
    const rate = resolution ? rates?.[resolution] : undefined;
    if (typeof rate !== 'number') {
        throw new Error(`No Veo pricing is registered for ${model} at ${resolution || 'the requested resolution'}.`);
    }
    return rate;
}
export function cleanBase64Data(imageData) {
    return imageData.replace(/^data:image\/[a-z]+;base64,/, '');
}
function formatGroundingChunks(chunks) {
    return chunks
        .filter(c => c?.web?.uri)
        .map((c, i) => `${i + 1}. ${c.web.title || 'Untitled'} – ${c.web.uri}`)
        .join('\n');
}
function normalizeGroundingChunk(chunk) {
    if (!chunk || typeof chunk !== 'object')
        return null;
    const webUri = chunk?.web?.uri;
    const webTitle = chunk?.web?.title;
    const imageUri = chunk?.image?.imageUri || chunk?.image?.image_uri || chunk?.image_uri;
    const imageLandingUri = chunk?.image?.uri || chunk?.uri;
    const uri = webUri || imageLandingUri;
    if (!uri && !imageUri)
        return null;
    return {
        ...(uri ? { uri } : {}),
        ...(imageUri ? { image_uri: imageUri } : {}),
        ...(webTitle ? { title: webTitle } : {}),
    };
}
function dedupeGroundingChunks(chunks) {
    const seen = new Set();
    const out = [];
    for (const chunk of chunks) {
        const key = `${chunk.uri || ''}|${chunk.image_uri || ''}|${chunk.title || ''}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(chunk);
    }
    return out;
}
function mergeImageMetadata(target, source) {
    const next = {
        ...target,
        model: source.model || target.model,
    };
    if (source.grounding) {
        const t = target.grounding || {};
        const s = source.grounding;
        next.grounding = {
            ...t,
            ...s,
            imageSearchQueries: Array.from(new Set([...(t.imageSearchQueries || []), ...(s.imageSearchQueries || [])])),
            webSearchQueries: Array.from(new Set([...(t.webSearchQueries || []), ...(s.webSearchQueries || [])])),
            groundingChunks: dedupeGroundingChunks([...(t.groundingChunks || []), ...(s.groundingChunks || [])]),
            groundingSupports: [...(t.groundingSupports || []), ...(s.groundingSupports || [])],
        };
    }
    next.thought_signatures = Array.from(new Set([...(target.thought_signatures || []), ...(source.thought_signatures || [])]));
    next.thoughts = [...(target.thoughts || []), ...(source.thoughts || [])];
    next.citations = dedupeGroundingChunks([...(target.citations || []), ...(source.citations || [])]);
    return next;
}
async function addImagesToInput(input, images, source) {
    for (const [image_id, imageData] of Object.entries(images)) {
        const mimeType = getImageMimeType(imageData);
        const cleanedImageData = cleanBase64Data(imageData);
        input.push({
            role: 'user',
            parts: [
                {
                    text: `[image #${image_id}] from the ${source}`,
                },
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: cleanedImageData,
                    },
                },
            ],
        });
    }
    return input;
}
function normalizeThoughtSignature(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function extractThoughtSignatureFromMessage(msg) {
    if (!msg || typeof msg !== 'object') {
        return null;
    }
    const direct = normalizeThoughtSignature(msg.thought_signature);
    if (direct) {
        return direct;
    }
    const candidate = msg;
    if (candidate.type !== 'thinking') {
        return null;
    }
    if (typeof candidate.signature === 'string') {
        return normalizeThoughtSignature(candidate.signature);
    }
    if (!Array.isArray(candidate.signature)) {
        return null;
    }
    for (const part of candidate.signature) {
        if (typeof part === 'string') {
            const parsed = normalizeThoughtSignature(part);
            if (parsed) {
                return parsed;
            }
            continue;
        }
        if (part && typeof part === 'object' && 'text' in part) {
            const parsed = normalizeThoughtSignature(part.text);
            if (parsed) {
                return parsed;
            }
        }
    }
    return null;
}
async function convertToGeminiContents(model, messages) {
    let contents = [];
    let pendingFunctionCallParts = [];
    let latestThoughtSignature = null;
    let pendingFunctionCallSignature = null;
    const flushPendingFunctionCalls = () => {
        if (pendingFunctionCallParts.length === 0) {
            return;
        }
        contents.push({
            role: 'model',
            parts: pendingFunctionCallParts,
        });
        pendingFunctionCallParts = [];
        pendingFunctionCallSignature = null;
    };
    for (const msg of messages) {
        if (msg.type === 'function_call') {
            let args;
            try {
                const parsedArgs = JSON.parse(msg.arguments || '{}');
                args = typeof parsedArgs === 'object' && parsedArgs !== null ? parsedArgs : { value: parsedArgs };
            }
            catch (e) {
                console.error(`Failed to parse function call arguments for ${msg.name}:`, truncateLargeValues(msg.arguments), e);
                args = {
                    error: 'Invalid JSON arguments provided',
                    raw_args: msg.arguments,
                };
            }
            const explicitThoughtSignature = extractThoughtSignatureFromMessage(msg);
            const thoughtSignature = explicitThoughtSignature || pendingFunctionCallSignature || latestThoughtSignature;
            if (explicitThoughtSignature) {
                pendingFunctionCallSignature = explicitThoughtSignature;
                latestThoughtSignature = explicitThoughtSignature;
            }
            else if (thoughtSignature && !pendingFunctionCallSignature) {
                pendingFunctionCallSignature = thoughtSignature;
            }
            pendingFunctionCallParts.push({
                functionCall: {
                    name: msg.name,
                    args,
                },
                ...(thoughtSignature ? { thoughtSignature } : {}),
            });
        }
        else if (msg.type === 'function_call_output') {
            flushPendingFunctionCalls();
            let textOutput = '';
            if (typeof msg.output === 'string') {
                textOutput = msg.output;
            }
            else {
                textOutput = JSON.stringify(msg.output);
            }
            const message = {
                role: 'user',
                parts: [
                    {
                        functionResponse: {
                            name: msg.name,
                            response: { content: textOutput || '' },
                        },
                    },
                ],
            };
            contents = await appendMessageWithImage(model, contents, message, {
                read: () => textOutput,
                write: value => {
                    message.parts[0].functionResponse.response.content = value;
                    return message;
                },
            }, addImagesToInput);
        }
        else {
            flushPendingFunctionCalls();
            const role = msg.role === 'assistant' ? 'model' : 'user';
            const thoughtSignature = msg.type === 'thinking' ? extractThoughtSignatureFromMessage(msg) : null;
            if (thoughtSignature) {
                latestThoughtSignature = thoughtSignature;
            }
            if (Array.isArray(msg.content)) {
                const parts = [];
                for (const item of msg.content) {
                    if (item.type === 'input_text') {
                        parts.push({
                            thought: msg.type === 'thinking',
                            text: item.text || '',
                        });
                    }
                    else if (item.type === 'input_image' || item.type === 'image') {
                        const normalized = normalizeImageDataUrl({
                            data: 'data' in item ? item.data : undefined,
                            image_url: 'image_url' in item ? item.image_url : undefined,
                            url: 'url' in item ? item.url : undefined,
                            mime_type: 'mime_type' in item ? item.mime_type : undefined,
                        });
                        const imageUrl = normalized.dataUrl || normalized.url || ('image_url' in item ? item.image_url : '');
                        if (imageUrl.startsWith('data:')) {
                            const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
                            if (match) {
                                const mimeType = match[1];
                                const base64Data = match[2];
                                parts.push({
                                    inlineData: {
                                        mimeType: mimeType,
                                        data: base64Data,
                                    },
                                });
                            }
                        }
                        else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                            parts.push({
                                fileData: {
                                    mimeType: inferImageMimeTypeFromUrl(imageUrl),
                                    fileUri: imageUrl,
                                },
                            });
                        }
                    }
                }
                if (thoughtSignature && parts.length > 0) {
                    parts[parts.length - 1] = {
                        ...parts[parts.length - 1],
                        thoughtSignature,
                    };
                }
                if (parts.length > 0) {
                    const message = { role, parts };
                    contents.push(message);
                }
            }
            else {
                let textContent = '';
                if (typeof msg.content === 'string') {
                    textContent = msg.content;
                }
                else {
                    textContent = JSON.stringify(msg.content);
                }
                const message = {
                    role,
                    parts: [
                        {
                            thought: msg.type === 'thinking',
                            text: textContent.trim(),
                            ...(thoughtSignature ? { thoughtSignature } : {}),
                        },
                    ],
                };
                contents = await appendMessageWithImage(model, contents, message, {
                    read: () => textContent,
                    write: value => {
                        message.parts[0].text = value;
                        return message;
                    },
                }, addImagesToInput);
            }
        }
    }
    flushPendingFunctionCalls();
    return contents;
}
const THINKING_BUDGET_CONFIGS = {
    '-low': 0,
    '-medium': 2048,
    '-high': 12288,
    '-max': 24576,
};
const THINKING_LEVEL_CONFIGS = {
    minimal: 'MINIMAL',
    low: 'LOW',
    medium: 'MEDIUM',
    high: 'HIGH',
};
const THINKING_LEVEL_ORDER = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
const THINKING_LEVEL_SUFFIX_CONFIGS = {
    '-none': 'MINIMAL',
    '-disabled': 'MINIMAL',
    '-minimal': 'MINIMAL',
    '-low': 'LOW',
    '-medium': 'MEDIUM',
    '-high': 'HIGH',
    '-max': 'HIGH',
    '-xhigh': 'HIGH',
};
function parseThinkingBudget(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return Math.max(0, Math.floor(value));
}
function chooseSupportedThinkingLevel(preferredLevel, supportedThinkingLevels) {
    if (supportedThinkingLevels.has(preferredLevel)) {
        return preferredLevel;
    }
    const preferredIndex = THINKING_LEVEL_ORDER.indexOf(preferredLevel);
    let closestLevel = null;
    let closestDistance = Infinity;
    for (const level of supportedThinkingLevels) {
        const distance = Math.abs(THINKING_LEVEL_ORDER.indexOf(level) - preferredIndex);
        if (distance < closestDistance) {
            closestDistance = distance;
            closestLevel = level;
        }
    }
    return closestLevel || 'HIGH';
}
function mapThinkingBudgetToThinkingLevel(budget, supportedThinkingLevels) {
    let preferredLevel;
    if (budget === 0) {
        preferredLevel = 'MINIMAL';
    }
    else if (budget <= 1024) {
        preferredLevel = 'LOW';
    }
    else if (budget <= 7168) {
        preferredLevel = 'MEDIUM';
    }
    else {
        preferredLevel = 'HIGH';
    }
    return chooseSupportedThinkingLevel(preferredLevel, supportedThinkingLevels);
}
function parseThinkingLevel(value) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'string') {
        throw new Error('Gemini thinking_level must be one of: minimal, low, medium, high.');
    }
    const level = value.trim().toLowerCase();
    if (level in THINKING_LEVEL_CONFIGS) {
        return THINKING_LEVEL_CONFIGS[level];
    }
    throw new Error('Gemini thinking_level must be one of: minimal, low, medium, high.');
}
function isGemmaModel(model) {
    const modelId = model.startsWith('models/') ? model.slice('models/'.length) : model;
    return modelId.startsWith('gemma-4-');
}
function isGemini25FlashImageModel(model) {
    return model.includes('gemini-2.5-flash-image');
}
function isGemini31FlashImageModel(model) {
    return model.includes('gemini-3.1-flash-image');
}
function isGemini31FlashLiteImageModel(model) {
    return model.includes('gemini-3.1-flash-lite-image');
}
function isGemini3ProImageModel(model) {
    return model.includes('gemini-3-pro-image');
}
function isGeminiStreamingImageModel(model) {
    return (isGemini25FlashImageModel(model) ||
        isGemini31FlashImageModel(model) ||
        isGemini31FlashLiteImageModel(model) ||
        isGemini3ProImageModel(model));
}
function getSupportedThinkingLevels(model) {
    if (isGemmaModel(model)) {
        return new Set(['HIGH']);
    }
    if (model.includes('gemini-3.8-flash') || model.includes('gemini-3.7-flash')) {
        return new Set(['LOW', 'MEDIUM', 'HIGH']);
    }
    if (model.includes('gemini-3.1-pro-preview') || model.includes('gemini-3-pro-preview')) {
        return new Set(['LOW', 'MEDIUM', 'HIGH']);
    }
    if (isGemini31FlashImageModel(model) || isGemini31FlashLiteImageModel(model)) {
        return new Set(['MINIMAL', 'HIGH']);
    }
    if (isGemini3ProImageModel(model)) {
        return new Set(['HIGH']);
    }
    if (model.includes('gemini-3.6-flash') ||
        model.includes('gemini-3.5-flash') ||
        model.includes('gemini-3.1-flash-lite') ||
        model.includes('gemini-3-flash-preview')) {
        return new Set(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']);
    }
    return null;
}
const GEMINI_3_PRO_IMAGE_DIMENSION_PRESETS = {
    '1024x1024': { ar: '1:1', imageSize: '1K' },
    '848x1264': { ar: '2:3', imageSize: '1K' },
    '1264x848': { ar: '3:2', imageSize: '1K' },
    '896x1200': { ar: '3:4', imageSize: '1K' },
    '1200x896': { ar: '4:3', imageSize: '1K' },
    '928x1152': { ar: '4:5', imageSize: '1K' },
    '1152x928': { ar: '5:4', imageSize: '1K' },
    '768x1376': { ar: '9:16', imageSize: '1K' },
    '1376x768': { ar: '16:9', imageSize: '1K' },
    '1584x672': { ar: '21:9', imageSize: '1K' },
    '2048x2048': { ar: '1:1', imageSize: '2K' },
    '1696x2528': { ar: '2:3', imageSize: '2K' },
    '2528x1696': { ar: '3:2', imageSize: '2K' },
    '1792x2400': { ar: '3:4', imageSize: '2K' },
    '2400x1792': { ar: '4:3', imageSize: '2K' },
    '1856x2304': { ar: '4:5', imageSize: '2K' },
    '2304x1856': { ar: '5:4', imageSize: '2K' },
    '1536x2752': { ar: '9:16', imageSize: '2K' },
    '2752x1536': { ar: '16:9', imageSize: '2K' },
    '3168x1344': { ar: '21:9', imageSize: '2K' },
    '4096x4096': { ar: '1:1', imageSize: '4K' },
    '3392x5056': { ar: '2:3', imageSize: '4K' },
    '5056x3392': { ar: '3:2', imageSize: '4K' },
    '3584x4800': { ar: '3:4', imageSize: '4K' },
    '4800x3584': { ar: '4:3', imageSize: '4K' },
    '3712x4608': { ar: '4:5', imageSize: '4K' },
    '4608x3712': { ar: '5:4', imageSize: '4K' },
    '3072x5504': { ar: '9:16', imageSize: '4K' },
    '5504x3072': { ar: '16:9', imageSize: '4K' },
    '6336x2688': { ar: '21:9', imageSize: '4K' },
};
function toGeminiMediaResolution(detail) {
    const mapped = mapGeminiMediaResolution(detail);
    return mapped ? MediaResolution[mapped] : undefined;
}
export class GeminiProvider extends BaseModelProvider {
    _client;
    apiKey;
    constructor(apiKey) {
        super('google');
        this.apiKey = apiKey;
    }
    getApiKey() {
        const apiKey = this.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('Failed to initialize Gemini client. GOOGLE_API_KEY or GEMINI_API_KEY is missing or not provided.');
        }
        return apiKey;
    }
    get client() {
        if (!this._client) {
            this._client = new GoogleGenAI({
                apiKey: this.getApiKey(),
                vertexai: false,
                httpOptions: { apiVersion: 'v1beta', retryOptions:{attempts:1} },
            });
        }
        return this._client;
    }
    async createEmbedding(input, model, agent, opts) {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        let finalRequestId = requestId;
        try {
            let actualModelId = model.startsWith('gemini/') ? model.substring(7) : model;
            const isGeminiEmbedding2 = actualModelId === 'gemini-embedding-2';
            if (isGeminiEmbedding2 && opts?.taskType) {
                throw new Error('gemini-embedding-2 does not support taskType. Include the task instruction directly in the text input.');
            }
            let thinkingConfig = null;
            for (const [suffix, budget] of Object.entries(THINKING_BUDGET_CONFIGS)) {
                if (actualModelId.endsWith(suffix)) {
                    thinkingConfig = { thinkingBudget: budget };
                    actualModelId = actualModelId.slice(0, -suffix.length);
                    break;
                }
            }
            console.log(`[Gemini] Generating embedding with model ${actualModelId}${opts?.dimensions ? ` (dimensions: ${opts.dimensions})` : ''}`);
            const payload = {
                model: actualModelId,
                contents: isGeminiEmbedding2 && Array.isArray(input) ? input.map(text => ({ parts: [{ text }] })) : input,
                config: {
                    ...(!isGeminiEmbedding2 && { taskType: opts?.taskType ?? 'SEMANTIC_SIMILARITY' }),
                    ...(opts?.dimensions && { outputDimensionality: opts.dimensions }),
                },
            };
            if (thinkingConfig) {
                payload.config.thinkingConfig = thinkingConfig;
            }
            const loggedRequestId = log_llm_request(agent.agent_id || 'default', 'gemini', actualModelId, {
                ...payload,
                input_length: Array.isArray(input) ? input.length : 1,
            }, new Date(), requestId, agent.tags);
            finalRequestId = loggedRequestId;
            const response = await this.client.models.embedContent(payload);
            console.log('[Gemini] Embedding response structure:', JSON.stringify(response, (key, value) => key === 'values' && Array.isArray(value) && value.length > 10
                ? `[${value.length} items]`
                : value, 2));
            if (!response.embeddings || !Array.isArray(response.embeddings)) {
                console.error('[Gemini] Unexpected embedding response structure:', truncateLargeValues(response));
                throw new Error('Invalid embedding response structure from Gemini API');
            }
            const estimatedTokens = typeof input === 'string'
                ? Math.ceil(input.length / 4)
                : input.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
            let extractedValues = [];
            let dimensions = 0;
            if (response.embeddings.length > 0) {
                if (response.embeddings[0].values) {
                    extractedValues = response.embeddings.map(e => e.values);
                    dimensions = extractedValues[0].length;
                }
                else {
                    console.warn('[Gemini] Could not find expected "values" property in embeddings response');
                    extractedValues = response.embeddings;
                    dimensions = Array.isArray(extractedValues[0]) ? extractedValues[0].length : 0;
                }
            }
            costTracker.addUsage({
                model: actualModelId,
                input_tokens: estimatedTokens,
                output_tokens: 0,
                metadata: {
                    dimensions,
                },
            });
            log_llm_response(finalRequestId, {
                model: actualModelId,
                dimensions,
                vector_count: extractedValues.length,
                estimated_tokens: estimatedTokens,
            });
            if (Array.isArray(input) && input.length > 1) {
                return extractedValues;
            }
            else {
                let result;
                if (Array.isArray(extractedValues) && extractedValues.length >= 1) {
                    const firstValue = extractedValues[0];
                    if (Array.isArray(firstValue)) {
                        result = firstValue;
                    }
                    else {
                        console.error('[Gemini] Unexpected format in embedding result:', truncateLargeValues(firstValue));
                        result = [];
                    }
                }
                else {
                    result = [];
                }
                return result;
            }
        }
        catch (error) {
            log_llm_error(finalRequestId, error);
            console.error('[Gemini] Error generating embedding:', truncateLargeValues(error));
            throw error;
        }
    }
    async *createResponseStream(messages, model, agent, requestId) {
        const { getToolsFromAgent } = await import('../utils/agent.js');
        const tools = agent ? await getToolsFromAgent(agent) : [];
        const settings = agent?.modelSettings;
        let messageId = uuidv4();
        let contentBuffer = '';
        let thoughtBuffer = '';
        let latestThoughtSignature = null;
        let eventOrder = 0;
        const shownGrounding = new Set();
        const withRequestId = (event) => {
            return requestId ? { ...event, request_id: requestId } : event;
        };
        const chunks = [];
        try {
            const requestedImageDetail = chooseImageDetailFromInput(messages);
            const contents = await convertToGeminiContents(model, messages);
            if (contents.length === 0) {
                console.warn('Gemini API Warning: No valid content found in messages after conversion. Adding default message.');
                contents.push({
                    role: 'user',
                    parts: [
                        {
                            text: "Let's think this through step by step.",
                        },
                    ],
                });
            }
            const lastContent = contents[contents.length - 1];
            if (lastContent.role !== 'user') {
                if (usesCurrentGeminiGenerateContentContract(model)) {
                    throw new Error(`${model} does not support a prefilled model turn; the final non-empty message must be from the user.`);
                }
                console.warn("Last message in history is not from 'user'. Gemini might not respond as expected.");
            }
            let thinkingBudget = null;
            let thinkingLevel = null;
            const thinkingBudgetFromSettings = parseThinkingBudget(settings?.thinking_budget);
            const thinkingLevelFromSettings = parseThinkingLevel(settings?.thinking_level);
            let strippedThinkingSuffix = false;
            for (const [suffix, level] of Object.entries(THINKING_LEVEL_SUFFIX_CONFIGS)) {
                if (!model.endsWith(suffix)) {
                    continue;
                }
                const baseModel = model.slice(0, -suffix.length);
                const supportedThinkingLevels = getSupportedThinkingLevels(baseModel);
                if (supportedThinkingLevels?.has(level)) {
                    thinkingLevel = level;
                    model = baseModel;
                    strippedThinkingSuffix = true;
                }
                else if (isGemmaModel(baseModel)) {
                    model = baseModel;
                    strippedThinkingSuffix = true;
                }
                break;
            }
            if (!strippedThinkingSuffix) {
                for (const [suffix, budget] of Object.entries(THINKING_BUDGET_CONFIGS)) {
                    if (model.endsWith(suffix)) {
                        thinkingBudget = budget;
                        model = model.slice(0, -suffix.length);
                        break;
                    }
                }
            }
            if (thinkingBudgetFromSettings !== null) {
                if (thinkingLevel !== null) {
                    throw new Error('Gemini thinking_budget cannot be combined with thinking_level or a model thinking suffix.');
                }
                const supportedThinkingLevels = getSupportedThinkingLevels(model);
                if (supportedThinkingLevels) {
                    if (isGemmaModel(model) && thinkingBudgetFromSettings === 0) {
                        thinkingLevel = null;
                    }
                    else {
                        thinkingLevel = mapThinkingBudgetToThinkingLevel(thinkingBudgetFromSettings, supportedThinkingLevels);
                    }
                }
                else {
                    thinkingBudget = thinkingBudgetFromSettings;
                }
            }
            if (thinkingLevelFromSettings !== null) {
                if (thinkingBudget !== null || thinkingLevel !== null) {
                    throw new Error('Gemini thinking_level cannot be combined with thinking_budget or a model thinking suffix.');
                }
                if (isGemmaModel(model) && thinkingLevelFromSettings !== 'HIGH') {
                    throw new Error('Gemma thinking_level only supports high; omit thinking_level to disable thinking.');
                }
                thinkingLevel = thinkingLevelFromSettings;
            }
            if (thinkingLevel !== null && thinkingBudget !== null) {
                throw new Error('Gemini thinking_level cannot be combined with thinking_budget or a model thinking suffix.');
            }
            const config = {};
            const thinkingConfig = {};
            if (!isGemmaModel(model)) {
                thinkingConfig.includeThoughts = true;
            }
            if (thinkingLevel !== null) {
                thinkingConfig.thinkingLevel = thinkingLevel;
            }
            else if (thinkingBudget !== null) {
                thinkingConfig.thinkingBudget = thinkingBudget;
            }
            if (Object.keys(thinkingConfig).length > 0) {
                config.thinkingConfig = thinkingConfig;
            }
            if (settings?.stop_sequence) {
                config.stopSequences = [settings.stop_sequence];
            }
            const supportsSamplingParameters = !usesCurrentGeminiGenerateContentContract(model);
            if (supportsSamplingParameters && settings?.temperature !== undefined) {
                config.temperature = settings.temperature;
            }
            if (settings?.max_tokens) {
                config.maxOutputTokens = settings.max_tokens;
            }
            if (supportsSamplingParameters && settings?.top_p !== undefined) {
                config.topP = settings.top_p;
            }
            if (supportsSamplingParameters && settings?.top_k !== undefined) {
                config.topK = settings.top_k;
            }
            if (settings?.json_schema) {
                config.responseMimeType = 'application/json';
                config.responseSchema = settings.json_schema.schema;
                if (config.responseSchema) {
                    const removeAdditionalProperties = (obj) => {
                        if (!obj || typeof obj !== 'object') {
                            return;
                        }
                        if ('additionalProperties' in obj) {
                            delete obj.additionalProperties;
                        }
                        if (obj.properties && typeof obj.properties === 'object') {
                            Object.values(obj.properties).forEach(prop => {
                                removeAdditionalProperties(prop);
                            });
                        }
                        if (obj.items) {
                            removeAdditionalProperties(obj.items);
                        }
                        ['oneOf', 'anyOf', 'allOf'].forEach(key => {
                            if (obj[key] && Array.isArray(obj[key])) {
                                obj[key].forEach((subSchema) => {
                                    removeAdditionalProperties(subSchema);
                                });
                            }
                        });
                    };
                    removeAdditionalProperties(config.responseSchema);
                }
            }
            if (agent.abortSignal) {
                config.abortSignal = agent.abortSignal;
            }
            const mediaResolution = toGeminiMediaResolution(requestedImageDetail);
            if (mediaResolution) {
                config.mediaResolution = mediaResolution;
            }
            let hasGoogleWebSearch = false;
            let hasCodeExecutionTool = false;
            let functionDeclarations = [];
            if (tools && tools.length > 0) {
                hasGoogleWebSearch = tools.some(tool => tool.definition.function.name === 'google_web_search');
                hasCodeExecutionTool = tools.some(tool => tool.definition.function.name === 'code_execution');
                functionDeclarations = await convertToGeminiFunctionDeclarations(tools);
                let allowedFunctionNames = [];
                if (functionDeclarations.length > 0) {
                    config.tools = [{ functionDeclarations }];
                    if (settings?.tool_choice) {
                        let toolChoice;
                        if (typeof settings.tool_choice === 'object' &&
                            settings.tool_choice?.type === 'function' &&
                            settings.tool_choice?.function?.name) {
                            toolChoice = FunctionCallingConfigMode.ANY;
                            allowedFunctionNames = [settings.tool_choice.function.name];
                        }
                        else if (settings.tool_choice === 'required') {
                            toolChoice = FunctionCallingConfigMode.ANY;
                        }
                        else if (settings.tool_choice === 'auto') {
                            toolChoice = FunctionCallingConfigMode.AUTO;
                        }
                        else if (settings.tool_choice === 'none') {
                            toolChoice = FunctionCallingConfigMode.NONE;
                        }
                        if (toolChoice) {
                            config.toolConfig = {
                                functionCallingConfig: {
                                    mode: toolChoice,
                                },
                            };
                            if (allowedFunctionNames.length > 0) {
                                config.toolConfig.functionCallingConfig.allowedFunctionNames = allowedFunctionNames;
                            }
                        }
                    }
                }
                else if (!hasGoogleWebSearch && !hasCodeExecutionTool) {
                    console.warn('Tools were provided but resulted in empty declarations after conversion.');
                }
            }
            if (hasGoogleWebSearch || hasCodeExecutionTool || functionDeclarations.length > 0) {
                const toolGroups = [];
                if (hasGoogleWebSearch) {
                    console.log('[Gemini] Enabling Google Search grounding');
                    toolGroups.push({ googleSearch: {} });
                }
                if (hasCodeExecutionTool) {
                    console.log('[Gemini] Enabling code execution');
                    toolGroups.push({ codeExecution: {} });
                }
                if (functionDeclarations.length > 0) {
                    toolGroups.push({ functionDeclarations });
                }
                config.tools = toolGroups;
                if (functionDeclarations.length === 0) {
                    delete config.toolConfig;
                }
            }
            const requestParams = {
                model,
                contents,
                config,
            };
            const loggedRequestId = log_llm_request(agent.agent_id, 'google', model, requestParams, new Date(), requestId, agent.tags);
            requestId = loggedRequestId;
            const { waitWhilePaused } = await import('../utils/pause_controller.js');
            await waitWhilePaused(100, agent.abortSignal);
            const hasImageInput = contents.some(content => (content.parts || []).some(part => Boolean(part?.inlineData || part?.fileData)));
            const useNonStreamingJsonResponse = Boolean(settings?.json_schema) &&
                hasImageInput &&
                !hasGoogleWebSearch &&
                !hasCodeExecutionTool &&
                functionDeclarations.length === 0;
            const response = useNonStreamingJsonResponse
                ? (async function* (provider) {
                    yield (await provider.client.models.generateContent(requestParams));
                })(this)
                : await this.client.models.generateContentStream(requestParams);
            let usageMetadata;
            for await (const chunk of response) {
                chunks.push(chunk);
                if (chunk.responseId) {
                    messageId = chunk.responseId;
                }
                if (isPaused()) {
                    console.log(`[Gemini] System paused during stream for model ${model}. Waiting...`);
                    await waitWhilePaused(100, agent.abortSignal);
                    console.log(`[Gemini] System resumed, continuing stream for model ${model}`);
                }
                if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                    const functionCallPartSignatures = [];
                    const discoveredFunctionSignatures = [];
                    for (const candidate of chunk.candidates || []) {
                        const parts = candidate?.content?.parts || [];
                        for (const part of parts) {
                            if (part?.functionCall) {
                                const normalizedPartSignature = normalizeThoughtSignature(part.thoughtSignature || part.thought_signature);
                                functionCallPartSignatures.push(normalizedPartSignature);
                                if (normalizedPartSignature) {
                                    discoveredFunctionSignatures.push(normalizedPartSignature);
                                }
                            }
                        }
                    }
                    const sharedFunctionCallSignature = discoveredFunctionSignatures.at(-1) || latestThoughtSignature || null;
                    for (const fc of chunk.functionCalls) {
                        if (fc && fc.name) {
                            const thoughtSignature = normalizeThoughtSignature(fc.thoughtSignature || fc.thought_signature) ||
                                functionCallPartSignatures.shift() ||
                                sharedFunctionCallSignature;
                            if (thoughtSignature) {
                                latestThoughtSignature = thoughtSignature;
                            }
                            yield withRequestId({
                                type: 'tool_start',
                                tool_call: {
                                    id: fc.id || `call_${uuidv4()}`,
                                    type: 'function',
                                    ...(thoughtSignature ? { thought_signature: thoughtSignature } : {}),
                                    function: {
                                        name: fc.name,
                                        arguments: JSON.stringify(fc.args || {}),
                                    },
                                },
                            });
                        }
                    }
                }
                for (const candidate of chunk.candidates) {
                    if (candidate.content?.parts) {
                        for (const part of candidate.content.parts) {
                            const thoughtSignature = normalizeThoughtSignature(part.thoughtSignature || part.thought_signature);
                            if (thoughtSignature) {
                                latestThoughtSignature = thoughtSignature;
                            }
                            let text = '';
                            if (part.text) {
                                text += part.text;
                            }
                            if (part.executableCode) {
                                if (text) {
                                    text += '\n\n';
                                }
                                text += part.executableCode;
                            }
                            if (part.videoMetadata) {
                                if (text) {
                                    text += '\n\n';
                                }
                                text += JSON.stringify(part.videoMetadata);
                            }
                            if (text.length > 0) {
                                const ev = {
                                    type: 'message_delta',
                                    content: '',
                                    message_id: messageId,
                                    order: eventOrder++,
                                };
                                if (part.thought) {
                                    thoughtBuffer += text;
                                    ev.thinking_content = text;
                                }
                                else {
                                    contentBuffer += text;
                                    ev.content = text;
                                }
                                yield ev;
                            }
                            if (part.inlineData?.data) {
                                yield withRequestId({
                                    type: 'file_complete',
                                    data_format: 'base64',
                                    data: part.inlineData.data,
                                    mime_type: part.inlineData.mimeType || 'image/png',
                                    message_id: uuidv4(),
                                    order: eventOrder++,
                                });
                            }
                        }
                    }
                    const gChunks = candidate.groundingMetadata?.groundingChunks;
                    if (Array.isArray(gChunks)) {
                        const newChunks = gChunks.filter(c => c?.web?.uri && !shownGrounding.has(c.web.uri));
                        if (newChunks.length) {
                            newChunks.forEach(c => shownGrounding.add(c.web.uri));
                            const formatted = formatGroundingChunks(newChunks);
                            yield withRequestId({
                                type: 'message_delta',
                                content: '\n\nSearch Results:\n' + formatted + '\n',
                                message_id: messageId,
                                order: eventOrder++,
                            });
                            contentBuffer += '\n\nSearch Results:\n' + formatted + '\n';
                        }
                    }
                }
                if (chunk.usageMetadata) {
                    usageMetadata = chunk.usageMetadata;
                }
            }
            if (usageMetadata) {
                const calculatedUsage = costTracker.addUsage(normalizeGeminiUsage(model, usageMetadata));
                if (!hasEventHandler()) {
                    yield withRequestId({
                        type: 'cost_update',
                        usage: calculatedUsage,
                    });
                }
            }
            else {
                console.warn('[Gemini] No usage metadata found in the response. Using token estimation.');
                let inputText = '';
                for (const content of contents) {
                    if (content.parts) {
                        for (const part of content.parts) {
                            if (part.text) {
                                inputText += part.text + '\n';
                            }
                        }
                    }
                }
                const calculatedUsage = costTracker.addEstimatedUsage(model, inputText, contentBuffer + thoughtBuffer, {
                    provider: 'gemini',
                });
                if (!hasEventHandler()) {
                    yield withRequestId({
                        type: 'cost_update',
                        usage: {
                            ...calculatedUsage,
                            total_tokens: calculatedUsage.input_tokens + calculatedUsage.output_tokens,
                        },
                    });
                }
            }
            if (contentBuffer || thoughtBuffer) {
                yield withRequestId({
                    type: 'message_complete',
                    content: contentBuffer,
                    thinking_content: thoughtBuffer,
                    ...(latestThoughtSignature ? { thinking_signature: latestThoughtSignature } : {}),
                    message_id: messageId,
                });
            }
        }
        catch (error) {
            log_llm_error(requestId, error);
            const errorMessage = error instanceof Error ? error.stack || error.message : String(error);
            if (errorMessage.includes('Incomplete JSON segment')) {
                console.error('[Gemini] Stream terminated with incomplete JSON. This may indicate network issues or timeouts.');
            }
            console.error('\n=== Gemini error ===');
            console.dir(error, { depth: null });
            console.error('\n=== JSON dump of error ===');
            console.error(truncateLargeValues(JSON.stringify(error, Object.getOwnPropertyNames(error), 2)));
            console.error('\n=== Manual property walk ===');
            for (const key of Reflect.ownKeys(error)) {
                console.error(`${String(key)}:`, truncateLargeValues(error[key]));
            }
            yield withRequestId({
                type: 'error',
                error: `Gemini error ${model}: ${errorMessage}`,
            });
            if (contentBuffer || thoughtBuffer) {
                yield withRequestId({
                    type: 'message_complete',
                    content: contentBuffer,
                    thinking_content: thoughtBuffer,
                    ...(latestThoughtSignature ? { thinking_signature: latestThoughtSignature } : {}),
                    message_id: messageId,
                });
            }
        }
        finally {
            log_llm_response(requestId, chunks);
        }
    }
    async createOmniVideo(prompt, model, agent, opts) {
        const actualModel = 'gemini-omni-flash-preview';
        const aspectRatio = opts.aspect_ratio || '16:9';
        if (aspectRatio !== '16:9' && aspectRatio !== '9:16') {
            throw new Error('Gemini Omni Flash video supports only 16:9 and 9:16 aspect ratios.');
        }
        if (opts.source_video || opts.end_image) {
            throw new Error('Gemini Omni Flash does not support source_video or first/last-frame interpolation in ensembleVideo.');
        }
        const input = [];
        if (opts.source_image) {
            const inline = parseImageDataUri(opts.source_image);
            input.push(inline
                ? { type: 'image', data: inline.data, mime_type: inline.mimeType }
                : {
                    type: 'image',
                    uri: opts.source_image,
                    mime_type: inferImageMimeTypeFromUrl(opts.source_image),
                });
        }
        input.push({ type: 'text', text: prompt });
        const body = {
            model: actualModel,
            input,
            response_format: {
                type: 'video',
                aspect_ratio: aspectRatio,
            },
            generation_config: {
                video_config: {
                    task: opts.source_image ? 'image_to_video' : 'text_to_video',
                },
            },
            background: false,
            store: false,
            stream: false,
        };
        const loggedRequestId = log_llm_request(agent.agent_id || 'default', 'google', actualModel, {
            prompt,
            aspect_ratio: aspectRatio,
            task: opts.source_image ? 'image_to_video' : 'text_to_video',
            has_source_image: Boolean(opts.source_image),
        }, new Date(), opts.request_id, agent.tags);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error('Gemini Omni Flash video generation timed out.')), opts.timeout_ms ?? 10 * 60_000);
        const onAbort = () => controller.abort(agent.abortSignal?.reason);
        agent.abortSignal?.addEventListener('abort', onAbort, { once: true });
        try {
            const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': this.getApiKey(),
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            const data = await response.json();
            if (!response.ok) {
                const message = data?.error?.message || data?.message || JSON.stringify(data);
                throw new Error(`Gemini Omni Flash request failed: ${response.status} ${message}`);
            }
            const video = findInteractionVideo(data);
            if (!video) {
                throw new Error('Gemini Omni Flash completed without a video output.');
            }
            const usage = data?.usage || {};
            const inputTokens = typeof usage.total_input_tokens === 'number' ? usage.total_input_tokens : 0;
            let videoOutputTokens = interactionTokenCountByModality(usage.output_tokens_by_modality, 'video');
            const textOutputTokens = interactionTokenCountByModality(usage.output_tokens_by_modality, 'text');
            if (videoOutputTokens === 0 && typeof usage.total_output_tokens === 'number') {
                videoOutputTokens = Math.max(0, usage.total_output_tokens - textOutputTokens);
            }
            const measuredSeconds = videoOutputTokens > 0 ? videoOutputTokens / 5792 : undefined;
            const estimatedSeconds = opts.duration || 4;
            const cost = videoOutputTokens > 0 || inputTokens > 0
                ? (inputTokens / 1_000_000) * 1.5 +
                    (videoOutputTokens / 1_000_000) * 17.5 +
                    (textOutputTokens / 1_000_000) * 9
                : estimatedSeconds * 0.10136;
            costTracker.addUsage({
                model: actualModel,
                input_tokens: inputTokens,
                output_tokens: videoOutputTokens + textOutputTokens,
                video_seconds: measuredSeconds || estimatedSeconds,
                cost,
                request_id: opts.request_id,
                metadata: {
                    source: 'google-interactions',
                    provider_request_id: data?.id,
                    aspect_ratio: aspectRatio,
                    output_video_tokens: videoOutputTokens,
                    output_text_tokens: textOutputTokens,
                    estimated_cost: videoOutputTokens === 0 && inputTokens === 0,
                },
            });
            log_llm_response(loggedRequestId, {
                ok: true,
                interaction_id: data?.id,
                status: data?.status,
                video_seconds: measuredSeconds,
                has_inline_video: Boolean(video.data),
            });
            if (video.data) {
                return [`data:${video.mimeType};base64,${video.data}`];
            }
            return [video.uri];
        }
        catch (error) {
            log_llm_error(loggedRequestId, error);
            log_llm_response(loggedRequestId, { ok: false });
            throw error;
        }
        finally {
            clearTimeout(timeout);
            agent.abortSignal?.removeEventListener('abort', onAbort);
        }
    }
    async createVeoVideo(prompt, model, agent, opts) {
        const duration = opts.duration ?? 8;
        const resolution = opts.resolution ?? '720p';
        const aspectRatio = opts.aspect_ratio ?? '16:9';
        if (![4, 6, 8].includes(duration)) {
            throw new Error('Veo 3.1 video duration must be 4, 6, or 8 seconds.');
        }
        if (!['720p', '1080p', '4k'].includes(resolution)) {
            throw new Error('Veo 3.1 video resolution must be 720p, 1080p, or 4k.');
        }
        if (model === 'veo-3.1-lite-generate-preview' && resolution === '4k') {
            throw new Error('Veo 3.1 Lite does not support 4k output.');
        }
        if (opts.end_image && duration !== 8) {
            throw new Error('Veo 3.1 end_image interpolation requires an 8-second duration in the Gemini Developer API.');
        }
        if (resolution !== '720p' && duration !== 8) {
            throw new Error('Veo 3.1 requires an 8-second duration for 1080p and 4k output.');
        }
        if (aspectRatio !== '16:9' && aspectRatio !== '9:16') {
            throw new Error('Veo 3.1 supports only 16:9 and 9:16 aspect ratios.');
        }
        if (opts.source_video) {
            throw new Error('Veo source_video extension is not yet supported by ensembleVideo.');
        }
        const image = opts.source_image ? await loadVideoSourceImage(opts.source_image, agent.abortSignal) : undefined;
        const lastFrame = opts.end_image ? await loadVideoSourceImage(opts.end_image, agent.abortSignal) : undefined;
        const loggedRequestId = log_llm_request(agent.agent_id || 'default', 'google', model, {
            prompt,
            duration,
            resolution,
            aspect_ratio: aspectRatio,
            has_source_image: Boolean(image),
            has_end_image: Boolean(lastFrame),
        }, new Date(), opts.request_id, agent.tags);
        try {
            let operation = await this.client.models.generateVideos({
                model,
                prompt,
                ...(image ? { image } : {}),
                config: {
                    numberOfVideos: 1,
                    durationSeconds: duration,
                    aspectRatio,
                    resolution,
                    personGeneration: image ? 'allow_adult' : 'allow_all',
                    ...(lastFrame ? { lastFrame } : {}),
                    ...(typeof opts.seed === 'number' ? { seed: opts.seed } : {}),
                    ...(opts.negative_prompt ? { negativePrompt: opts.negative_prompt } : {}),
                    ...(agent.abortSignal ? { abortSignal: agent.abortSignal } : {}),
                },
            });
            const deadline = Date.now() + (opts.timeout_ms ?? 10 * 60_000);
            while (!operation.done) {
                if (Date.now() >= deadline) {
                    throw new Error('Veo 3.1 video generation timed out.');
                }
                await waitForGeminiVideoPoll(opts.poll_interval_ms ?? 5000, agent.abortSignal);
                operation = await this.client.operations.getVideosOperation({ operation });
            }
            if (operation.error) {
                throw new Error(`Veo 3.1 generation failed: ${JSON.stringify(operation.error)}`);
            }
            const generatedVideos = operation.response?.generatedVideos || [];
            const videos = [];
            for (const generated of generatedVideos) {
                const video = generated.video;
                if (!video)
                    continue;
                const mimeType = video.mimeType || 'video/mp4';
                if (video.videoBytes) {
                    videos.push(`data:${mimeType};base64,${video.videoBytes}`);
                    continue;
                }
                if (video.uri) {
                    const response = await fetch(video.uri, {
                        headers: { 'x-goog-api-key': this.getApiKey() },
                        signal: agent.abortSignal,
                    });
                    if (!response.ok) {
                        throw new Error(`Failed to download Veo video: ${response.status} ${response.statusText}`);
                    }
                    const bytes = Buffer.from(await response.arrayBuffer()).toString('base64');
                    videos.push(`data:${mimeType};base64,${bytes}`);
                }
            }
            if (videos.length === 0) {
                const reasons = operation.response?.raiMediaFilteredReasons;
                throw new Error(reasons?.length
                    ? `Veo 3.1 returned no video: ${reasons.join('; ')}`
                    : 'Veo 3.1 completed without a video output.');
            }
            const rate = veoVideoRate(model, resolution);
            costTracker.addUsage({
                model,
                video_seconds: duration * videos.length,
                cost: rate * duration * videos.length,
                request_id: opts.request_id,
                metadata: {
                    source: 'google-veo',
                    provider_request_id: operation.name,
                    resolution,
                    aspect_ratio: aspectRatio,
                    cost_per_second: rate,
                    audio: 'always-on',
                    estimated_cost: true,
                },
            });
            log_llm_response(loggedRequestId, {
                ok: true,
                operation_name: operation.name,
                video_count: videos.length,
                duration,
                resolution,
            });
            return videos;
        }
        catch (error) {
            log_llm_error(loggedRequestId, error);
            log_llm_response(loggedRequestId, { ok: false });
            throw error;
        }
    }
    async createVideo(prompt, model, agent, opts = {}) {
        if (model === 'gemini-omni-flash' || model === 'gemini-omni-flash-preview') {
            return this.createOmniVideo(prompt, model, agent, opts);
        }
        if (model === 'veo-3.1-generate-preview' ||
            model === 'veo-3.1-fast-generate-preview' ||
            model === 'veo-3.1-lite-generate-preview') {
            return this.createVeoVideo(prompt, model, agent, opts);
        }
        throw new Error(`Gemini provider does not support video generation for model ${model}.`);
    }
    async createImage(prompt, model, agent, opts) {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        let finalRequestId = requestId;
        try {
            model = model || 'gemini-3.1-flash-image';
            const numberOfImages = opts?.n ?? 1;
            if (!Number.isInteger(numberOfImages) || numberOfImages < 1) {
                throw new Error('[Gemini] ImageGenerationOpts.n must be a positive integer.');
            }
            const { getToolsFromAgent } = await import('../utils/agent.js');
            const tools = agent ? await getToolsFromAgent(agent) : [];
            const hasGoogleWebSearch = tools?.some(tool => tool.definition.function.name === 'google_web_search');
            const hasOtherTools = tools?.some(tool => tool.definition.function.name !== 'google_web_search');
            if (hasOtherTools) {
                console.warn('[Gemini] Image generation ignores function tools; only google_web_search is supported.');
            }
            const explicitWebGrounding = opts?.grounding?.web_search;
            const explicitImageGrounding = opts?.grounding?.image_search;
            const isGemini31FlashImage = isGemini31FlashImageModel(model);
            const isGemini31FlashLiteImage = isGemini31FlashLiteImageModel(model);
            const isGemini3ProImage = isGemini3ProImageModel(model);
            const supportsWebGrounding = isGemini31FlashImage || isGemini3ProImage;
            const enableWebGrounding = supportsWebGrounding && (explicitWebGrounding ?? hasGoogleWebSearch ?? false);
            const enableImageGrounding = explicitImageGrounding === true && isGemini31FlashImage;
            if ((explicitWebGrounding || hasGoogleWebSearch) && !supportsWebGrounding) {
                console.warn('[Gemini] Google Search grounding is only available for gemini-3.1-flash-image and gemini-3-pro-image. Ignoring web_search=true.');
            }
            if (explicitImageGrounding && !isGemini31FlashImage) {
                console.warn('[Gemini] Image Search grounding is only available for gemini-3.1-flash-image. Ignoring image_search=true.');
            }
            const thinkingOptions = opts?.thinking;
            const hasThinkingOptionsObject = thinkingOptions !== null && typeof thinkingOptions === 'object' && !Array.isArray(thinkingOptions);
            const includeThoughts = hasThinkingOptionsObject &&
                thinkingOptions.include_thoughts === true;
            const requestedThinkingLevel = hasThinkingOptionsObject
                ? thinkingOptions.level
                : undefined;
            const thinkingLevel = requestedThinkingLevel === 'high' ? 'High' : requestedThinkingLevel ? 'Minimal' : undefined;
            const supportsImageThinkingControls = isGemini31FlashImage || isGemini31FlashLiteImage;
            if (requestedThinkingLevel && !supportsImageThinkingControls) {
                console.warn('[Gemini] thinking.level is currently supported for gemini-3.1-flash-image and gemini-3.1-flash-lite-image only. Ignoring thinking level.');
            }
            if (hasThinkingOptionsObject && 'include_thoughts' in thinkingOptions && !supportsImageThinkingControls) {
                console.warn('[Gemini] thinking.include_thoughts is currently supported for gemini-3.1-flash-image and gemini-3.1-flash-lite-image only. Ignoring include_thoughts.');
            }
            let aspectRatio = '1:1';
            if (opts?.size === 'landscape')
                aspectRatio = '3:2';
            else if (opts?.size === 'portrait')
                aspectRatio = '2:3';
            console.log(`[Gemini] Generating ${numberOfImages} image(s) with model ${model}, prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
            if (isGeminiStreamingImageModel(model)) {
                let aggregateMetadata = { model };
                const sizeMap = {
                    '1:1': { ar: '1:1' },
                    '1:4': { ar: '1:4' },
                    '1:8': { ar: '1:8' },
                    '2:3': { ar: '2:3' },
                    '3:2': { ar: '3:2' },
                    '3:4': { ar: '3:4' },
                    '4:1': { ar: '4:1' },
                    '4:3': { ar: '4:3' },
                    '4:5': { ar: '4:5' },
                    '5:4': { ar: '5:4' },
                    '8:1': { ar: '8:1' },
                    '9:16': { ar: '9:16' },
                    '16:9': { ar: '16:9' },
                    '21:9': { ar: '21:9' },
                    square: { ar: '1:1' },
                    landscape: { ar: '3:2' },
                    portrait: { ar: '2:3' },
                    '256x256': { ar: '1:1' },
                    '512x512': { ar: '1:1' },
                    '1024x1024': { ar: '1:1' },
                    '1536x1024': { ar: '3:2' },
                    '1024x1536': { ar: '2:3' },
                    '1696x2528': { ar: '2:3' },
                    '2048x2048': { ar: '1:1' },
                    '1792x1024': { ar: '16:9' },
                    '1024x1792': { ar: '9:16' },
                };
                const sm = opts?.size ? sizeMap[String(opts.size)] : undefined;
                const gemini3ProDimensionPreset = isGemini3ProImage
                    ? GEMINI_3_PRO_IMAGE_DIMENSION_PRESETS[String(opts?.size)]
                    : undefined;
                const imageConfig = {};
                if (sm?.ar)
                    imageConfig.aspectRatio = sm.ar;
                if (gemini3ProDimensionPreset?.ar)
                    imageConfig.aspectRatio = gemini3ProDimensionPreset.ar;
                const qualityKey = typeof opts?.quality === 'string' ? opts.quality.toLowerCase() : '';
                if (isGemini31FlashLiteImage && imageConfig.aspectRatio) {
                    const liteAspectRatios = new Set([
                        '1:1',
                        '2:3',
                        '3:2',
                        '3:4',
                        '4:3',
                        '4:5',
                        '5:4',
                        '9:16',
                        '16:9',
                        '21:9',
                    ]);
                    if (!liteAspectRatios.has(imageConfig.aspectRatio)) {
                        throw new Error(`[Gemini] gemini-3.1-flash-lite-image does not support aspect ratio ${imageConfig.aspectRatio}.`);
                    }
                }
                const imageSizeMap = isGemini31FlashImage
                    ? {
                        low: '0.5K',
                        standard: '1K',
                        medium: '2K',
                        hd: '4K',
                        high: '4K',
                    }
                    : isGemini31FlashLiteImage
                        ? {
                            low: '1K',
                            standard: '1K',
                            medium: '1K',
                            hd: '1K',
                            high: '1K',
                        }
                        : {
                            low: '1K',
                            standard: '2K',
                            medium: '2K',
                            hd: '4K',
                            high: '4K',
                        };
                let imageSize = imageSizeMap[qualityKey];
                if (gemini3ProDimensionPreset?.imageSize) {
                    imageSize = gemini3ProDimensionPreset.imageSize;
                }
                if (isGemini31FlashImage && opts?.size === '512x512') {
                    imageSize = '0.5K';
                }
                if (isGemini31FlashLiteImage) {
                    imageSize = '1K';
                    if (opts?.size === '512x512') {
                        throw new Error('[Gemini] gemini-3.1-flash-lite-image only supports 1K image output.');
                    }
                }
                const requestImageSize = imageSize === '0.5K' ? '512' : imageSize;
                if (requestImageSize)
                    imageConfig.imageSize = requestImageSize;
                const thinkingConfig = {};
                if (hasThinkingOptionsObject &&
                    'include_thoughts' in thinkingOptions &&
                    supportsImageThinkingControls) {
                    thinkingConfig.includeThoughts = includeThoughts;
                }
                if (thinkingLevel && supportsImageThinkingControls) {
                    thinkingConfig.thinkingLevel = thinkingLevel;
                }
                const searchTypes = {};
                if (enableWebGrounding)
                    searchTypes.webSearch = {};
                if (enableImageGrounding)
                    searchTypes.imageSearch = {};
                const googleSearchTool = Object.keys(searchTypes).length > 0
                    ? {
                        googleSearch: {
                            searchTypes,
                        },
                    }
                    : undefined;
                const perImageCost = this.getImageCost(model, imageSize);
                const sourceImageMediaResolution = toGeminiMediaResolution(opts?.detail);
                const makeOne = async () => {
                    const requestParams = {
                        model,
                        contents: [
                            {
                                role: 'user',
                                parts: [
                                    ...(Array.isArray(opts?.source_images)
                                        ? opts.source_images
                                            .map((img) => (typeof img === 'string' ? { _src: img } : img))
                                            .map((it) => {
                                            const src = it?.data || it?._src || it;
                                            if (typeof src !== 'string')
                                                return null;
                                            if (src.startsWith('data:')) {
                                                const m = /^data:([^;]+);base64,(.+)$/i.exec(src);
                                                if (!m)
                                                    return null;
                                                return {
                                                    inlineData: {
                                                        mimeType: m[1] || 'image/png',
                                                        data: m[2],
                                                    },
                                                };
                                            }
                                            return {
                                                fileData: {
                                                    mimeType: inferImageMimeTypeFromUrl(src),
                                                    fileUri: src,
                                                },
                                            };
                                        })
                                            .filter(Boolean)
                                        : typeof opts?.source_images === 'string'
                                            ? [
                                                (() => {
                                                    const s = String(opts?.source_images);
                                                    if (s.startsWith('data:')) {
                                                        const m = /^data:([^;]+);base64,(.+)$/i.exec(s);
                                                        return m
                                                            ? {
                                                                inlineData: {
                                                                    mimeType: m[1] || 'image/png',
                                                                    data: m[2],
                                                                },
                                                            }
                                                            : null;
                                                    }
                                                    return {
                                                        fileData: {
                                                            mimeType: inferImageMimeTypeFromUrl(s),
                                                            fileUri: s,
                                                        },
                                                    };
                                                })(),
                                            ].filter(Boolean)
                                            : []),
                                    { text: prompt },
                                ],
                            },
                        ],
                        config: {
                            responseModalities: [Modality.IMAGE],
                            ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
                            ...(sourceImageMediaResolution ? { mediaResolution: sourceImageMediaResolution } : {}),
                            ...(googleSearchTool ? { tools: [googleSearchTool] } : {}),
                            ...(Object.keys(thinkingConfig).length ? { thinkingConfig: thinkingConfig } : {}),
                        },
                    };
                    const loggedRequestId = log_llm_request(agent.agent_id || 'default', 'gemini', model, requestParams, new Date(), requestId, agent.tags);
                    finalRequestId = loggedRequestId;
                    const response = await this.client.models.generateContentStream(requestParams);
                    const wantsSingleImage = numberOfImages === 1;
                    const images = [];
                    let firstImage = null;
                    let metadata = { model };
                    let usageMetadata;
                    const closeResponseStream = async () => {
                        const responseWithReturn = response;
                        if (typeof responseWithReturn.return === 'function') {
                            try {
                                await responseWithReturn.return();
                            }
                            catch {
                            }
                        }
                    };
                    for await (const chunk of response) {
                        if (chunk.usageMetadata) {
                            usageMetadata = chunk.usageMetadata;
                        }
                        if (!chunk.candidates)
                            continue;
                        for (const cand of chunk.candidates) {
                            const groundingMetadata = cand.groundingMetadata;
                            if (groundingMetadata) {
                                const chunks = Array.isArray(groundingMetadata.groundingChunks)
                                    ? groundingMetadata.groundingChunks
                                        .map((c) => normalizeGroundingChunk(c))
                                        .filter((c) => !!c)
                                    : [];
                                const searchEntryPoint = groundingMetadata.searchEntryPoint;
                                const imageSearchQueries = Array.isArray(groundingMetadata.imageSearchQueries)
                                    ? groundingMetadata.imageSearchQueries
                                        .map((q) => (typeof q === 'string' ? q : q?.query || q?.text))
                                        .filter((q) => typeof q === 'string' && q.length > 0)
                                    : [];
                                const webSearchQueries = Array.isArray(groundingMetadata.webSearchQueries)
                                    ? groundingMetadata.webSearchQueries
                                        .map((q) => (typeof q === 'string' ? q : q?.query || q?.text))
                                        .filter((q) => typeof q === 'string' && q.length > 0)
                                    : [];
                                metadata = mergeImageMetadata(metadata, {
                                    model,
                                    grounding: {
                                        ...(imageSearchQueries.length ? { imageSearchQueries } : {}),
                                        ...(webSearchQueries.length ? { webSearchQueries } : {}),
                                        ...(chunks.length ? { groundingChunks: chunks } : {}),
                                        ...(Array.isArray(groundingMetadata.groundingSupports)
                                            ? { groundingSupports: groundingMetadata.groundingSupports }
                                            : {}),
                                        ...(searchEntryPoint ? { searchEntryPoint } : {}),
                                    },
                                    citations: chunks.filter(c => !!c.uri),
                                });
                            }
                            const parts = cand.content?.parts || [];
                            for (const part of parts) {
                                const thoughtSignature = part.thoughtSignature || part.thought_signature;
                                if (thoughtSignature) {
                                    metadata = mergeImageMetadata(metadata, {
                                        model,
                                        thought_signatures: [thoughtSignature],
                                    });
                                }
                                if (part.thought) {
                                    if (includeThoughts) {
                                        const thoughtPart = {
                                            thought: true,
                                            type: part.inlineData?.data ? 'image' : 'text',
                                            ...(part.text ? { text: part.text } : {}),
                                            ...(part.inlineData?.mimeType
                                                ? { mime_type: part.inlineData.mimeType }
                                                : {}),
                                            ...(part.inlineData?.data ? { data: part.inlineData.data } : {}),
                                            ...(thoughtSignature ? { thought_signature: thoughtSignature } : {}),
                                        };
                                        metadata = mergeImageMetadata(metadata, {
                                            model,
                                            thoughts: [thoughtPart],
                                        });
                                    }
                                    continue;
                                }
                                if (part.inlineData?.data) {
                                    const mime = part.inlineData.mimeType || 'image/png';
                                    const imageData = `data:${mime};base64,${part.inlineData.data}`;
                                    if (wantsSingleImage) {
                                        firstImage = imageData;
                                        await closeResponseStream();
                                        break;
                                    }
                                    images.push(imageData);
                                }
                            }
                            if (wantsSingleImage && firstImage) {
                                break;
                            }
                        }
                        if (wantsSingleImage && firstImage) {
                            break;
                        }
                    }
                    const finalImages = wantsSingleImage && firstImage ? [firstImage] : images;
                    if (finalImages.length > 0) {
                        const baseMetadata = {
                            cost_per_image: perImageCost,
                            ...(imageSize ? { image_size: imageSize } : {}),
                        };
                        if (usageMetadata) {
                            const promptTokensRaw = usageMetadata.promptTokenCount || 0;
                            const toolTokens = usageMetadata.toolUsePromptTokenCount || 0;
                            const thoughtTokens = usageMetadata.thoughtsTokenCount || 0;
                            const candidateTokens = usageMetadata.candidatesTokenCount || 0;
                            const totalTokens = usageMetadata.totalTokenCount || 0;
                            let promptTokens = promptTokensRaw;
                            if (promptTokens === 0 && totalTokens > 0) {
                                const derivedPrompt = totalTokens - candidateTokens - toolTokens - thoughtTokens;
                                if (derivedPrompt > 0) {
                                    promptTokens = derivedPrompt;
                                }
                            }
                            const inputTokens = promptTokens + toolTokens;
                            const outputTokens = candidateTokens + thoughtTokens;
                            costTracker.addUsage({
                                model,
                                image_count: finalImages.length,
                                input_tokens: inputTokens,
                                output_tokens: outputTokens,
                                cached_tokens: usageMetadata.cachedContentTokenCount || 0,
                                reasoning_tokens: thoughtTokens,
                                request_id: opts?.request_id,
                                metadata: {
                                    ...baseMetadata,
                                    total_tokens: totalTokens,
                                    reasoning_tokens: thoughtTokens,
                                    tool_tokens: toolTokens,
                                },
                            });
                        }
                        else {
                            costTracker.addUsage({
                                model,
                                image_count: finalImages.length,
                                request_id: opts?.request_id,
                                metadata: baseMetadata,
                            });
                        }
                    }
                    return { images: finalImages, metadata };
                };
                const allImages = [];
                const calls = Math.max(1, numberOfImages);
                for (let i = 0; i < calls; i++) {
                    const { images: imgs, metadata } = await makeOne();
                    aggregateMetadata = mergeImageMetadata(aggregateMetadata, metadata);
                    for (const img of imgs) {
                        if (allImages.length < numberOfImages)
                            allImages.push(img);
                    }
                    if (allImages.length >= numberOfImages)
                        break;
                }
                if (aggregateMetadata.grounding?.groundingChunks) {
                    aggregateMetadata.citations = dedupeGroundingChunks(aggregateMetadata.grounding.groundingChunks.filter(c => !!c.uri));
                }
                if (opts?.on_metadata) {
                    await opts.on_metadata(aggregateMetadata);
                }
                if (allImages.length === 0) {
                    throw new Error(`No images returned from ${model} model`);
                }
                log_llm_response(finalRequestId, {
                    model,
                    image_count: allImages.length,
                    cost: allImages.length * perImageCost,
                });
                return allImages;
            }
            const requestParams = {
                model,
                prompt,
                config: {
                    numberOfImages,
                    aspectRatio,
                    includeSafetyAttributes: false,
                },
            };
            const loggedRequestId = log_llm_request(agent.agent_id || 'default', 'gemini', model, requestParams, new Date(), requestId, agent.tags);
            finalRequestId = loggedRequestId;
            const response = await this.client.models.generateImages(requestParams);
            const images = [];
            if (response.generatedImages && response.generatedImages.length > 0) {
                for (const generatedImage of response.generatedImages) {
                    if (generatedImage.image?.imageBytes) {
                        const base64Image = `data:image/png;base64,${generatedImage.image.imageBytes}`;
                        images.push(base64Image);
                    }
                }
                const perImageCost = this.getImageCost(model);
                costTracker.addUsage({
                    model,
                    image_count: images.length,
                    cost: images.length * perImageCost,
                    request_id: opts?.request_id,
                    metadata: {
                        aspect_ratio: aspectRatio,
                        cost_per_image: perImageCost,
                    },
                });
            }
            if (images.length === 0) {
                throw new Error('No images returned from Gemini/Imagen');
            }
            const perImageCost = this.getImageCost(model);
            log_llm_response(finalRequestId, {
                model,
                image_count: images.length,
                aspect_ratio: aspectRatio,
                cost: images.length * perImageCost,
            });
            return images;
        }
        catch (error) {
            log_llm_error(finalRequestId, error);
            console.error('[Gemini] Error generating image:', truncateLargeValues(error));
            throw error;
        }
    }
    getImageCost(model, imageSize) {
        if (isGemini31FlashImageModel(model)) {
            if (imageSize === '4K')
                return 0.151;
            if (imageSize === '2K')
                return 0.101;
            if (imageSize === '0.5K')
                return 0.045;
            return 0.067;
        }
        else if (isGemini31FlashLiteImageModel(model)) {
            return 0.0336;
        }
        else if (isGemini25FlashImageModel(model)) {
            return 0.039;
        }
        else if (isGemini3ProImageModel(model)) {
            if (imageSize === '4K')
                return 0.24;
            return 0.134;
        }
        if (model.includes('imagen-3')) {
            return 0.04;
        }
        else if (model.includes('imagen-2')) {
            return 0.02;
        }
        return 0.04;
    }
    async createVoice(text, model, agent, opts) {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        let finalRequestId = requestId;
        try {
            console.log(`[Gemini] Generating speech with model ${model}, text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
            const voiceName = this.mapVoiceToGemini(opts?.voice);
            const speechConfig = {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: voiceName,
                    },
                },
            };
            const config = {
                responseModalities: [Modality.AUDIO],
                speechConfig: speechConfig,
            };
            let say_prefix = '';
            let say_postfix = '';
            if (opts?.speed && opts.speed !== 1.0) {
                const speedDescription = opts.speed < 1.0
                    ? `slowly at ${Math.round(opts.speed * 100)}% speed`
                    : `quickly at ${Math.round(opts.speed * 100)}% speed`;
                say_postfix = speedDescription;
            }
            if (opts?.affect) {
                say_prefix = `Sound ${opts.affect}`;
            }
            if (say_postfix || say_prefix) {
                if (say_postfix && say_prefix) {
                    text = `${say_prefix} and say ${say_postfix}:\n${text}`;
                }
                else if (say_postfix) {
                    text = `Say ${say_postfix}:\n${text}`;
                }
                else if (say_prefix) {
                    text = `${say_prefix} and say:\n${text}`;
                }
            }
            const requestParams = {
                model,
                text_length: text.length,
                voice: voiceName,
                speed: opts?.speed,
                affect: opts?.affect,
                config,
            };
            const loggedRequestId = log_llm_request(agent.agent_id || 'default', 'gemini', model, requestParams, new Date(), requestId, agent.tags);
            finalRequestId = loggedRequestId;
            console.log(`[Gemini] Starting generateContentStream call...`);
            const streamPromise = this.client.models.generateContentStream({
                model,
                contents: [{ role: 'user', parts: [{ text }] }],
                config,
            });
            const textLength = text.length;
            costTracker.addUsage({
                model,
                input_tokens: Math.ceil(textLength / 4),
                output_tokens: 0,
                metadata: {
                    voice: voiceName,
                    text_length: textLength,
                    type: 'voice_generation',
                },
            });
            if (opts?.stream) {
                const stream = await streamPromise;
                const chunks = [];
                for await (const chunk of stream) {
                    if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
                        const part = chunk.candidates[0].content.parts[0];
                        const binaryString = atob(part.inlineData.data);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        chunks.push(bytes);
                        if (part.inlineData.mimeType) {
                            console.log(`[Gemini] Audio format: ${part.inlineData.mimeType}`);
                        }
                    }
                }
                const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const combined = new Uint8Array(totalLength);
                let offset = 0;
                for (const chunk of chunks) {
                    combined.set(chunk, offset);
                    offset += chunk.length;
                }
                log_llm_response(finalRequestId, {
                    model,
                    text_length: textLength,
                    voice: voiceName,
                    audio_size: combined.length,
                    stream: true,
                });
                return new ReadableStream({
                    start(controller) {
                        controller.enqueue(combined);
                        controller.close();
                    },
                });
            }
            let allData = new Uint8Array(0);
            const stream = await streamPromise;
            for await (const chunk of stream) {
                if (!chunk.candidates || !chunk.candidates[0]?.content?.parts) {
                    continue;
                }
                const part = chunk.candidates[0].content.parts[0];
                if (part?.inlineData?.data) {
                    const binaryString = atob(part.inlineData.data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const newData = new Uint8Array(allData.length + bytes.length);
                    newData.set(allData);
                    newData.set(bytes, allData.length);
                    allData = newData;
                }
            }
            if (allData.length === 0) {
                throw new Error('No audio data generated from Gemini TTS');
            }
            log_llm_response(finalRequestId, {
                model,
                text_length: textLength,
                voice: voiceName,
                audio_size: allData.length,
                stream: false,
            });
            return allData.buffer;
        }
        catch (error) {
            log_llm_error(finalRequestId, error);
            console.error('[Gemini] Error generating voice:', truncateLargeValues(error));
            throw error;
        }
    }
    mapVoiceToGemini(voice) {
        const geminiVoices = [
            'Kore',
            'Puck',
            'Charon',
            'Fenrir',
            'Aoede',
            'Glados',
        ];
        if (!voice) {
            return 'Kore';
        }
        if (geminiVoices.includes(voice)) {
            return voice;
        }
        const voiceMap = {
            alloy: 'Kore',
            echo: 'Puck',
            fable: 'Charon',
            onyx: 'Fenrir',
            nova: 'Aoede',
            shimmer: 'Glados',
            male: 'Puck',
            female: 'Kore',
            neutral: 'Charon',
            young: 'Aoede',
            mature: 'Fenrir',
            robotic: 'Glados',
            kore: 'Kore',
            puck: 'Puck',
            charon: 'Charon',
            fenrir: 'Fenrir',
            aoede: 'Aoede',
            glados: 'Glados',
        };
        const mappedVoice = voiceMap[voice.toLowerCase()];
        if (mappedVoice) {
            return mappedVoice;
        }
        console.warn(`[Gemini] Unknown voice '${voice}', using default voice 'Kore'`);
        return 'Kore';
    }
    async *createTranscription(audio, agent, model, opts) {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        let finalRequestId = requestId;
        let session = null;
        let isConnected = false;
        try {
            const ai = new GoogleGenAI({
                apiKey: this.apiKey,
                httpOptions: { apiVersion: 'v1beta', retryOptions:{attempts:1} },
            });
            const realtimeInputConfig = opts?.realtimeInputConfig || {
                automaticActivityDetection: {
                    disabled: false,
                    startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
                    endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
                },
            };
            const speechConfig = opts?.speechConfig || {
                languageCode: 'en-US',
            };
            const systemInstruction = agent.instructions || `You should reply only "OK" to every single message from the user. Nothing else.`;
            console.log('[Gemini] Connecting to Live API for transcription...');
            const connectionPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 10000);
                const config = {
                    responseModalities: [Modality.TEXT],
                    mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
                    speechConfig,
                    realtimeInputConfig,
                    systemInstruction: {
                        parts: [{ text: systemInstruction }],
                    },
                    inputAudioTranscription: {},
                };
                ai.live
                    .connect({
                    model: model,
                    config,
                    callbacks: {
                        onopen: () => {
                            clearTimeout(timeout);
                            console.log('[Gemini] Live session connected');
                            isConnected = true;
                            resolve();
                        },
                        onmessage: async (msg) => {
                            if (msg.serverContent?.inputTranscription?.text) {
                                const previewEvent = {
                                    type: 'transcription_turn_delta',
                                    timestamp: new Date().toISOString(),
                                    delta: msg.serverContent.inputTranscription.text,
                                };
                                transcriptEvents.push(previewEvent);
                            }
                            if (msg.serverContent?.turnComplete) {
                                const turnEvent = {
                                    type: 'transcription_turn_complete',
                                    timestamp: new Date().toISOString(),
                                };
                                transcriptEvents.push(turnEvent);
                            }
                            if (msg.usageMetadata) {
                                if (msg.usageMetadata.promptTokensDetails &&
                                    Array.isArray(msg.usageMetadata.promptTokensDetails)) {
                                    for (const detail of msg.usageMetadata.promptTokensDetails) {
                                        if (detail.modality && detail.tokenCount > 0) {
                                            costTracker.addUsage({
                                                model: model,
                                                input_tokens: detail.tokenCount,
                                                output_tokens: 0,
                                                input_modality: detail.modality.toLowerCase(),
                                                metadata: {
                                                    totalTokens: msg.usageMetadata.totalTokenCount || 0,
                                                    source: 'gemini-live-transcription',
                                                    modalityType: 'input',
                                                    originalModality: detail.modality,
                                                },
                                            });
                                        }
                                    }
                                }
                                if (msg.usageMetadata.responseTokensDetails &&
                                    Array.isArray(msg.usageMetadata.responseTokensDetails)) {
                                    for (const detail of msg.usageMetadata.responseTokensDetails) {
                                        if (detail.modality && detail.tokenCount > 0) {
                                            costTracker.addUsage({
                                                model: model,
                                                input_tokens: 0,
                                                output_tokens: detail.tokenCount,
                                                output_modality: detail.modality.toLowerCase(),
                                                metadata: {
                                                    totalTokens: msg.usageMetadata.totalTokenCount || 0,
                                                    source: 'gemini-live-transcription',
                                                    modalityType: 'output',
                                                    originalModality: detail.modality,
                                                },
                                            });
                                        }
                                    }
                                }
                                if ((!msg.usageMetadata.promptTokensDetails ||
                                    msg.usageMetadata.promptTokensDetails.length === 0) &&
                                    (!msg.usageMetadata.responseTokensDetails ||
                                        msg.usageMetadata.responseTokensDetails.length === 0)) {
                                    costTracker.addUsage({
                                        model: model,
                                        input_tokens: msg.usageMetadata.promptTokenCount || 0,
                                        output_tokens: msg.usageMetadata.responseTokenCount || 0,
                                        input_modality: 'audio',
                                        output_modality: 'text',
                                        metadata: {
                                            totalTokens: msg.usageMetadata.totalTokenCount || 0,
                                            source: 'gemini-live-transcription',
                                        },
                                    });
                                }
                            }
                        },
                        onerror: (err) => {
                            console.error('[Gemini] Live API error:', truncateLargeValues({
                                code: err.code,
                                reason: err.reason,
                                wasClean: err.wasClean,
                            }));
                            connectionError = err;
                        },
                        onclose: (event) => {
                            console.log('[Gemini] Live session closed');
                            if (event) {
                                console.log('[Gemini] Close event details:', {
                                    code: event.code,
                                    reason: event.reason,
                                    wasClean: event.wasClean,
                                });
                            }
                            isConnected = false;
                        },
                    },
                })
                    .then(async (s) => {
                    session = s;
                });
            });
            const transcriptEvents = [];
            let connectionError = null;
            await connectionPromise;
            const requestParams = {
                model,
                systemInstruction,
                realtimeInputConfig,
                speechConfig,
                mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
            };
            const loggedRequestId = log_llm_request(agent.agent_id, 'gemini', model, requestParams, new Date(), requestId, agent.tags);
            finalRequestId = loggedRequestId;
            const audioStream = normalizeAudioSource(audio);
            const reader = audioStream.getReader();
            const sendAudioChunk = async (chunk) => {
                try {
                    const base64Data = chunk.toString('base64');
                    await session.sendRealtimeInput({
                        media: {
                            mimeType: 'audio/pcm;rate=16000',
                            data: base64Data,
                        },
                    });
                }
                catch (err) {
                    console.error('[Gemini] Error sending audio chunk:', truncateLargeValues(err));
                    connectionError = err;
                    throw err;
                }
            };
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    if (value && session && isConnected) {
                        const chunk = value instanceof Buffer ? value : Buffer.from(value);
                        await sendAudioChunk(chunk);
                    }
                    if (transcriptEvents.length > 0) {
                        const events = transcriptEvents.splice(0, transcriptEvents.length);
                        for (const event of events) {
                            yield event;
                        }
                    }
                    if (connectionError) {
                        throw connectionError;
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (transcriptEvents.length > 0) {
                    const events = transcriptEvents.splice(0, transcriptEvents.length);
                    for (const event of events) {
                        yield event;
                    }
                }
                log_llm_response(finalRequestId, {
                    model,
                    transcription_complete: true,
                });
            }
            finally {
                reader.releaseLock();
                if (session) {
                    session.close();
                }
            }
        }
        catch (error) {
            log_llm_error(finalRequestId, error);
            console.error('[Gemini] Transcription error:', truncateLargeValues(error));
            const errorEvent = {
                type: 'error',
                timestamp: new Date().toISOString(),
                error: error instanceof Error ? error.message : 'Transcription failed',
            };
            yield errorEvent;
        }
    }

}
function normalizeAudioSource(source) {
    if (source instanceof ReadableStream) {
        return source;
    }
    if (typeof source === 'object' && source !== null && Symbol.asyncIterator in source) {
        return new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of source) {
                        controller.enqueue(chunk);
                    }
                    controller.close();
                }
                catch (error) {
                    controller.error(error);
                }
            },
        });
    }
    if (typeof source === 'function') {
        const iterable = source();
        return normalizeAudioSource(iterable);
    }
    if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
        const data = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
        return new ReadableStream({
            start(controller) {
                controller.enqueue(data);
                controller.close();
            },
        });
    }
    throw new Error(`Unsupported audio source type: ${typeof source}`);
}
export const geminiProvider = new GeminiProvider();
