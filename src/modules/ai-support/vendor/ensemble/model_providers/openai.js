import { BaseModelProvider } from './base_provider.js';
import OpenAI from 'openai';
import { costTracker } from '../utils/cost_tracker.js';
import { log_llm_request, log_llm_response, log_llm_error } from '../utils/llm_logger.js';
import { isPaused } from '../utils/pause_controller.js';
import { appendMessageWithImage, normalizeImageDataUrl } from '../utils/image_utils.js';
import { mapOpenAIImageDetail, mapOpenAIImageInputFidelity } from '../utils/image_detail.js';
import { bufferDelta, flushBufferedDeltas } from '../utils/delta_buffer.js';
import { createCitationTracker, formatCitation, generateFootnotes } from '../utils/citation_tracker.js';
import { hasEventHandler } from '../utils/event_controller.js';
import { createProviderErrorEvent } from '../utils/failure_detection.js';
import { processSchemaForOpenAI } from '../utils/json_schema.js';
import { getOpenAIImageCostMetadata, buildOpenAIImageUsageRecord, getOpenAIImageCostEstimate, normalizeOpenAIImageQuality, normalizeOpenAIImageSize, } from './openai_image_pricing.js';
import { DEFAULT_OPENAI_IMAGE_TIMEOUT_MS, OpenAIImageRequestError, runOpenAIImageRequest, } from './openai_image_request.js';
import { prepareOpenAIImageEditInput } from './openai_image_edit_input.js';
import { findModel } from '../data/model_data.js';
import { buildEventsFromOpenAIResponse } from './openai_response_events.js';
import { OpenAIChat } from './openai_chat.js';
import { normalizeOpenAIResponsesUsage } from '../utils/provider_usage.js';
const BROWSER_WIDTH = 1024;
const BROWSER_HEIGHT = 1536;
const WEBSOCKET_OPEN_STATE = 1;
const REALTIME_WHISPER_MODEL = 'gpt-realtime-whisper';
function requiresReasoning(modelName) {
    if (modelName.startsWith('o'))
        return true;
    if (modelName.startsWith('gpt-')) {
        const match = modelName.match(/^gpt-(\d+)/);
        if (match) {
            const version = parseInt(match[1], 10);
            return version >= 5;
        }
    }
    return false;
}
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
async function convertToOpenAITools(requestParams, tools) {
    requestParams.tools = await Promise.all(tools.map(async (tool) => {
        if (tool.definition.function.name === 'openai_web_search') {
            delete requestParams.reasoning;
            return {
                type: 'web_search_preview',
                search_context_size: 'high',
            };
        }
        const resolvedParams = await resolveAsyncEnums(tool.definition.function.parameters);
        const originalToolProperties = resolvedParams.properties;
        const paramSchema = processSchemaForOpenAI(resolvedParams, originalToolProperties, originalToolProperties ? 'tool_parameters' : 'json_schema');
        return {
            type: 'function',
            name: tool.definition.function.name,
            description: tool.definition.function.description,
            parameters: paramSchema,
            strict: true,
        };
    }));
    if (requestParams.model === 'computer-use-preview') {
        requestParams.tools.push({
            type: 'computer_use_preview',
            display_width: BROWSER_WIDTH,
            display_height: BROWSER_HEIGHT,
            environment: 'browser',
        });
    }
    requestParams.truncation = 'auto';
    return requestParams;
}
async function addImagesToInput(input, images, source) {
    for (const [image_id, imageData] of Object.entries(images)) {
        input.push({
            type: 'message',
            role: 'user',
            content: [
                {
                    type: 'input_text',
                    text: `[image #${image_id}] from the ${source}`,
                },
                {
                    type: 'input_image',
                    image_url: imageData,
                },
            ],
        });
    }
    return input;
}
async function convertContentPartsToOpenAI(content) {
    if (!Array.isArray(content))
        return content;
    const parts = [];
    for (const item of content) {
        if (item.type === 'input_text') {
            parts.push(item);
        }
        else if (item.type === 'input_image' || item.type === 'image') {
            const normalized = normalizeImageDataUrl({
                data: 'data' in item ? item.data : undefined,
                image_url: 'image_url' in item ? item.image_url : undefined,
                url: 'url' in item ? item.url : undefined,
                mime_type: 'mime_type' in item ? item.mime_type : undefined,
            });
            const imageUrl = normalized.dataUrl || normalized.url || ('image_url' in item ? item.image_url : '');
            if (!imageUrl)
                continue;
            if (imageUrl.startsWith('data:')) {
                const detail = mapOpenAIImageDetail(item.detail);
                parts.push({
                    type: 'input_image',
                    image_url: imageUrl,
                    ...(detail ? { detail } : {}),
                });
            }
            else {
                const detail = mapOpenAIImageDetail(item.detail);
                parts.push({
                    type: 'input_image',
                    image_url: imageUrl,
                    ...(detail ? { detail } : {}),
                });
            }
        }
    }
    return parts;
}
export class OpenAIProvider extends BaseModelProvider {
    _client;
    apiKey;
    constructor(apiKey) {
        super('openai');
        this.apiKey = apiKey;
    }
    get client() {
        if (!this._client) {
            const apiKey = this.apiKey || process.env.OPENAI_API_KEY;
            if (!apiKey) {
                throw new Error('Failed to initialize OpenAI client. Make sure OPENAI_API_KEY is set.');
            }
            this._client = new OpenAI({
                maxRetries: 0,
                apiKey: apiKey,
            });
        }
        return this._client;
    }
    async createEmbedding(input, model, agent, opts) {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        let finalRequestId = requestId;
        try {
            const options = {
                model,
                input: input,
                encoding_format: 'float',
            };
            if (opts?.dimensions) {
                options.dimensions = opts.dimensions;
            }
            const loggedRequestId = log_llm_request(agent.agent_id || 'default', 'openai', model, options, new Date(), requestId, agent.tags);
            finalRequestId = loggedRequestId;
            const response = await this.client.embeddings.create(options);
            const inputTokens = response.usage?.prompt_tokens ||
                (typeof input === 'string'
                    ? Math.ceil(input.length / 4)
                    : input.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0));
            costTracker.addUsage({
                model,
                input_tokens: inputTokens,
                output_tokens: 0,
                metadata: {
                    dimensions: response.data[0]?.embedding.length || options.dimensions,
                },
            });
            log_llm_response(finalRequestId, response);
            if (Array.isArray(input) && input.length > 1) {
                return response.data.map(item => item.embedding);
            }
            else {
                return response.data[0].embedding;
            }
        }
        catch (error) {
            log_llm_error(finalRequestId, error);
            console.error('[OpenAI] Error generating embedding:', error);
            throw error;
        }
    }
    async createImage(prompt, model, agent, opts) {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        let finalRequestId = requestId;
        try {
            model = model || 'gpt-image-1.5';
            const number_of_images = opts?.n || 1;
            const quality = normalizeOpenAIImageQuality(opts?.quality);
            const size = normalizeOpenAIImageSize(model, opts?.size);
            const background = opts?.background || 'auto';
            const input_fidelity = opts?.input_fidelity ?? mapOpenAIImageInputFidelity(opts?.detail);
            const source_images = opts?.source_images;
            console.log(`[OpenAI] Generating ${number_of_images} image(s) with model ${model}, prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
            const configuredTimeoutMs = opts?.timeout_ms ?? agent.modelSettings?.timeout_ms;
            const timeoutMs = configuredTimeoutMs ?? DEFAULT_OPENAI_IMAGE_TIMEOUT_MS;
            if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
                throw new RangeError('OpenAI image timeout_ms must be a positive finite number.');
            }
            const idempotencyKey = opts?.idempotency_key ?? opts?.request_id;
            const requestOptions = (signal) => ({
                signal,
                timeout: timeoutMs,
                maxRetries: 0,
                ...(idempotencyKey
                    ? {
                        idempotencyKey,
                        headers: { 'Idempotency-Key': idempotencyKey },
                    }
                    : {}),
            });
            let response;
            let providerRequestId;
            if (source_images) {
                console.log('[OpenAI] Using images.edit with source_images');
                const result = await runOpenAIImageRequest({
                    operationName: `OpenAI image edit with ${model}`,
                    timeoutMs,
                    abortSignal: agent.abortSignal,
                    execute: async (signal) => {
                        const { editParams, requestLogData } = await prepareOpenAIImageEditInput({
                            model,
                            prompt,
                            sourceImages: source_images,
                            mask: opts?.mask,
                            numberOfImages: number_of_images,
                            background,
                            quality,
                            size,
                            inputFidelity: input_fidelity,
                            signal,
                        });
                        finalRequestId = log_llm_request(agent.agent_id || 'default', 'openai', model, requestLogData, new Date(), requestId, agent.tags);
                        return await this.client.images.edit(editParams, requestOptions(signal)).withResponse();
                    },
                });
                response = result.data;
                providerRequestId = result.request_id || undefined;
            }
            else {
                const generateParams = {
                    model,
                    prompt,
                    n: number_of_images,
                    background,
                    quality,
                    size,
                    moderation: 'low',
                    output_format: 'png',
                };
                const loggedRequestId = log_llm_request(agent.agent_id || 'default', 'openai', model, generateParams, new Date(), requestId, agent.tags);
                finalRequestId = loggedRequestId;
                const result = await runOpenAIImageRequest({
                    operationName: `OpenAI image generation with ${model}`,
                    timeoutMs,
                    abortSignal: agent.abortSignal,
                    execute: async (signal) => await this.client.images.generate(generateParams, requestOptions(signal)).withResponse(),
                });
                response = result.data;
                providerRequestId = result.request_id || undefined;
            }
            await opts?.on_metadata?.({
                model,
                provider: 'openai',
                ...(providerRequestId ? { provider_request_id: providerRequestId } : {}),
                ...(opts.request_id ? { request_id: opts.request_id } : {}),
            });
            if (response.data && response.data.length > 0) {
                const usageMetadata = {
                    quality,
                    size,
                    is_edit: !!source_images,
                };
                const tokenUsageRecord = response.usage
                    ? buildOpenAIImageUsageRecord(model, response.usage, response.data.length, opts?.request_id, usageMetadata)
                    : undefined;
                if (tokenUsageRecord) {
                    costTracker.addUsage(tokenUsageRecord);
                }
                else {
                    const perImageCost = this.getImageCost(model, quality, size);
                    const totalCost = perImageCost * response.data.length;
                    costTracker.addUsage({
                        model,
                        image_count: response.data.length,
                        cost: totalCost,
                        request_id: opts?.request_id,
                        metadata: {
                            ...usageMetadata,
                            ...getOpenAIImageCostMetadata(model, quality, size),
                            cost_per_image: perImageCost,
                            estimated: true,
                        },
                    });
                }
            }
            if (!response.data || response.data.length === 0) {
                throw new OpenAIImageRequestError('No images returned from OpenAI', {
                    reason: 'empty_response',
                    retryable: false,
                    providerRequestId,
                });
            }
            const imageDataUrls = response.data.map(item => {
                const imageData = item?.b64_json;
                if (!imageData) {
                    throw new OpenAIImageRequestError('No image data returned from OpenAI', {
                        reason: 'empty_response',
                        retryable: false,
                        providerRequestId,
                    });
                }
                return `data:image/png;base64,${imageData}`;
            });
            log_llm_response(finalRequestId, response);
            return imageDataUrls;
        }
        catch (error) {
            log_llm_error(finalRequestId, error);
            console.error('[OpenAI] Error generating image:', error);
            throw error;
        }
    }
    getImageCost(model, quality, size) {
        return getOpenAIImageCostEstimate(model, quality, size);
    }
    async createVoice(text, model, agent, opts) {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        let finalRequestId = requestId;
        try {
            const voice = opts?.voice || 'alloy';
            const speed = opts?.speed || 1.0;
            let response_format = opts?.response_format || 'mp3';
            if (response_format.includes('pcm')) {
                response_format = 'pcm';
            }
            if (response_format.includes('mp3')) {
                response_format = 'mp3';
            }
            if (model === 'gpt-audio-1.5') {
                const response = await this.client.chat.completions.create({
                    model,
                    modalities: ['text', 'audio'],
                    audio: { voice: opts?.voice || 'alloy', format: response_format },
                    messages: [{ role: 'user', content: text }],
                });
                const audio = response.choices[0]?.message?.audio?.data;
                if (typeof audio !== 'string')
                    throw new Error('gpt-audio-1.5 returned no audio data.');
                costTracker.addUsage({
                    model,
                    input_tokens: response.usage?.prompt_tokens || 0,
                    output_tokens: response.usage?.completion_tokens || 0,
                    input_modality: 'text',
                    output_modality: 'audio',
                });
                const bytes = Buffer.from(audio, 'base64');
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            }
            let instructions = opts?.instructions || undefined;
            if (opts?.affect) {
                instructions = `Sound ${opts.affect}${instructions ? ' and ' + instructions : ''}`;
            }
            const speechRequest = {
                model,
                input: text,
                instructions,
                voice,
                speed,
                response_format: response_format,
            };
            const loggedRequestId = log_llm_request(agent.agent_id || 'default', 'openai', model, speechRequest, new Date(), requestId, agent.tags);
            finalRequestId = loggedRequestId;
            const response = await this.client.audio.speech.create(speechRequest);
            const characterCount = text.length;
            const costPerThousandChars = model === 'tts-1-hd' ? 0.03 : 0.015;
            const cost = (characterCount / 1000) * costPerThousandChars;
            costTracker.addUsage({
                model,
                cost,
                metadata: {
                    character_count: characterCount,
                    voice,
                    format: response_format,
                },
            });
            log_llm_response(finalRequestId, {
                status: 'success',
                headers: response.headers,
                body_type: opts?.stream ? 'ReadableStream' : 'ArrayBuffer',
                content_type: response.headers?.['content-type'] || 'audio/mpeg',
            });
            if (opts?.stream) {
                const nodeStream = response.body;
                return new ReadableStream({
                    async start(controller) {
                        for await (const chunk of nodeStream) {
                            controller.enqueue(new Uint8Array(chunk));
                        }
                        controller.close();
                    },
                });
            }
            else {
                const buffer = await response.arrayBuffer();
                return buffer;
            }
        }
        catch (error) {
            log_llm_error(finalRequestId, error);
            console.error('[OpenAI] Error generating speech:', error);
            throw error;
        }
    }
    async *createResponseStream(messages, model, agent, requestId) {
        if (model === 'gpt-audio-1.5') {
            const chatProvider = new OpenAIChat('openai', this.apiKey || process.env.OPENAI_API_KEY);
            yield* chatProvider.createResponseStream(messages, model, agent, requestId);
            return;
        }
        const { getToolsFromAgent } = await import('../utils/agent.js');
        const tools = agent ? await getToolsFromAgent(agent) : [];
        const settings = agent?.modelSettings;
        try {
            let input = [];
            const pendingFunctionOutputs = [];
            let currentReasoningId = null;
            for (const messageFull of messages) {
                let message = { ...messageFull };
                const originalModel = message.model;
                const allowedMessageProps = [
                    'type',
                    'role',
                    'content',
                    'status',
                    'id',
                    'name',
                    'thinking_id',
                    'signature',
                    'arguments',
                    'call_id',
                    'output',
                    'images',
                    'image_detail',
                    'image_url',
                    'detail',
                    'action',
                    'command',
                    'env',
                    'timeout_ms',
                    'user',
                    'working_directory',
                    'server_label',
                    'tools',
                    'error',
                    'approval_request_id',
                    'approve',
                    'reason',
                    'acknowledged_safety_checks',
                    'annotations',
                    'input_schema',
                    'description',
                    'result',
                    'generated',
                ];
                Object.keys(message).forEach(key => {
                    if (!allowedMessageProps.includes(key)) {
                        delete message[key];
                    }
                });
                if (message.type === 'thinking') {
                    if (requiresReasoning(model) && message.thinking_id && model === originalModel) {
                        const match = message.thinking_id.match(/^(rs_[A-Za-z0-9]+)-(\d)$/);
                        if (match) {
                            const reasoningId = match[1];
                            const summaryIndex = parseInt(match[2], 10);
                            currentReasoningId = reasoningId;
                            const summaryText = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
                            const summaryEntry = {
                                type: 'summary_text',
                                text: summaryText,
                            };
                            const existingIndex = input.findIndex((item) => item.type === 'reasoning' && item.id === reasoningId);
                            if (existingIndex !== -1) {
                                const existingItem = input[existingIndex];
                                if (!existingItem.summary) {
                                    existingItem.summary = [];
                                }
                                existingItem.summary[summaryIndex] = summaryEntry;
                                input[existingIndex] = existingItem;
                            }
                            else {
                                const newItem = {
                                    type: 'reasoning',
                                    id: reasoningId,
                                    summary: [],
                                };
                                newItem.summary[summaryIndex] = summaryEntry;
                                input.push(newItem);
                            }
                            continue;
                        }
                    }
                    input.push({
                        type: 'message',
                        role: 'user',
                        content: 'Thinking: ' + message.content,
                        status: message.status || 'completed',
                    });
                    continue;
                }
                if (message.type === 'function_call') {
                    const isAssociatedWithReasoning = currentReasoningId && message.id && message.id.startsWith('fc_') && model === originalModel;
                    if (message.id && (!message.id.startsWith('fc_') || model !== originalModel)) {
                        const { id, ...rest } = message;
                        message = rest;
                        if (!message.call_id && id) {
                            message.call_id = id;
                        }
                    }
                    message.status = message.status || 'completed';
                    input.push(message);
                    if (!isAssociatedWithReasoning && pendingFunctionOutputs.length > 0) {
                        for (const output of pendingFunctionOutputs) {
                            input = await appendMessageWithImage(model, input, output.messageToAdd, 'output', addImagesToInput, output.description);
                        }
                        pendingFunctionOutputs.length = 0;
                        currentReasoningId = null;
                    }
                    continue;
                }
                if (message.type === 'function_call_output') {
                    const { name, id, ...messageToAdd } = message;
                    if (currentReasoningId && requiresReasoning(model)) {
                        pendingFunctionOutputs.push({
                            messageToAdd,
                            description: `function call output of ${message.name}`,
                        });
                    }
                    else {
                        input = await appendMessageWithImage(model, input, messageToAdd, 'output', addImagesToInput, `function call output of ${message.name}`);
                    }
                    continue;
                }
                if ((message.type ?? 'message') === 'message' && 'content' in message) {
                    if (pendingFunctionOutputs.length > 0) {
                        for (const output of pendingFunctionOutputs) {
                            input = await appendMessageWithImage(model, input, output.messageToAdd, 'output', addImagesToInput, output.description);
                        }
                        pendingFunctionOutputs.length = 0;
                        currentReasoningId = null;
                    }
                    if ('id' in message && message.id && (!message.id.startsWith('msg_') || model !== originalModel)) {
                        const { id, ...rest } = message;
                        message = rest;
                    }
                    if (Array.isArray(message.content)) {
                        const convertedContent = await convertContentPartsToOpenAI(message.content);
                        input.push({
                            ...message,
                            type: 'message',
                            content: convertedContent,
                        });
                    }
                    else {
                        input = await appendMessageWithImage(model, input, { ...message, type: 'message' }, 'content', addImagesToInput);
                    }
                    continue;
                }
            }
            if (pendingFunctionOutputs.length > 0) {
                for (const output of pendingFunctionOutputs) {
                    input = await appendMessageWithImage(model, input, output.messageToAdd, 'output', addImagesToInput, output.description);
                }
            }
            if (input.length === 0) {
                input.push({
                    type: 'message',
                    role: 'user',
                    content: 'Please proceed.',
                });
            }
            let requestParams = {
                model,
                stream: true,
                user: 'magi',
                input,
            };
            // Responses names this limit differently from the shared model settings.
            // Apply it for every selected OpenAI model, including those without an assist wrapper.
            if (settings?.max_tokens !== undefined) {
                if (!Number.isSafeInteger(settings.max_tokens) || settings.max_tokens < 1) {
                    throw new Error('max_tokens must be a positive integer');
                }
                requestParams.max_output_tokens = settings.max_tokens;
            }
            const parseThinkingBudget = (value) => {
                if (typeof value !== 'number' || !Number.isFinite(value)) {
                    return null;
                }
                return Math.max(0, Math.floor(value));
            };
            const mapThinkingBudgetToReasoningEffort = (budget) => {
                if (!Number.isFinite(budget) || budget < 0) {
                    return undefined;
                }
                if (budget === 0)
                    return 'none';
                if (budget <= 2048)
                    return 'minimal';
                if (budget <= 8192)
                    return 'low';
                if (budget <= 16384)
                    return 'medium';
                if (budget <= 32768)
                    return 'high';
                return 'xhigh';
            };
            const isO3Model = (m) => m === 'o3' || m.startsWith('o3-');
            const isGpt5Family = (m) => m.startsWith('gpt-5');
            const isGptWithSamplingAtNoReasoning = (m) => m.startsWith('gpt-5.1') ||
                m.startsWith('gpt-5.2') ||
                m.startsWith('gpt-5.4') ||
                m.startsWith('gpt-5.5');
            const getDefaultReasoningEffort = (m) => {
                if (m === 'gpt-5.5-pro' || m === 'gpt-5.4-pro' || m === 'gpt-5.2-pro' || m === 'gpt-5-pro')
                    return 'high';
                if (m.startsWith('gpt-5.4') || m.startsWith('gpt-5.2') || m.startsWith('gpt-5.1'))
                    return 'none';
                if (m.startsWith('gpt-5'))
                    return 'medium';
                if (m.startsWith('o'))
                    return 'high';
                return undefined;
            };
            const REASONING_EFFORT_CONFIGS = [
                'none',
                'minimal',
                'low',
                'medium',
                'high',
                'xhigh',
                'max',
            ];
            let requestedReasoningEffort;
            for (const effort of REASONING_EFFORT_CONFIGS) {
                const suffix = `-${effort}`;
                const isSupportedEffortSuffix = effort !== 'max' || model.startsWith('gpt-5.6');
                if (isSupportedEffortSuffix && model.endsWith(suffix)) {
                    requestedReasoningEffort = effort;
                    model = model.slice(0, -suffix.length);
                    requestParams.model = model;
                    break;
                }
            }
            const thinkingBudgetFromSettings = parseThinkingBudget(settings?.thinking_budget);
            const thinkingBudgetEffort = thinkingBudgetFromSettings !== null
                ? mapThinkingBudgetToReasoningEffort(thinkingBudgetFromSettings)
                : undefined;
            if (thinkingBudgetEffort !== undefined) {
                requestedReasoningEffort = thinkingBudgetEffort;
            }
            if (settings?.reasoning_mode === 'pro' && !model.startsWith('gpt-5.6')) {
                throw new Error('reasoning_mode: "pro" is only supported by GPT-5.6 models.');
            }
            const defaultEffort = getDefaultReasoningEffort(model);
            const effectiveEffort = requestedReasoningEffort ?? defaultEffort;
            if (requestedReasoningEffort) {
                if (requestedReasoningEffort === 'none') {
                    requestParams.reasoning = {
                        effort: 'none',
                        ...(settings?.reasoning_mode && { mode: settings.reasoning_mode }),
                    };
                }
                else {
                    requestParams.reasoning = {
                        effort: requestedReasoningEffort,
                        summary: 'auto',
                        ...(settings?.reasoning_mode && { mode: settings.reasoning_mode }),
                    };
                }
            }
            else if (requiresReasoning(model)) {
                if (defaultEffort && defaultEffort !== 'none') {
                    requestParams.reasoning = {
                        effort: defaultEffort,
                        summary: 'auto',
                        ...(settings?.reasoning_mode && { mode: settings.reasoning_mode }),
                    };
                }
            }
            if (!isO3Model(model)) {
                if (settings?.temperature !== undefined) {
                    requestParams.temperature = settings.temperature;
                }
                if (settings?.top_p !== undefined) {
                    requestParams.top_p = settings.top_p;
                }
            }
            if (isGpt5Family(model)) {
                const allowSamplingParams = isGptWithSamplingAtNoReasoning(model) && effectiveEffort === 'none';
                if (!allowSamplingParams) {
                    delete requestParams.temperature;
                    delete requestParams.top_p;
                }
            }
            if (settings?.tool_choice) {
                if (typeof settings.tool_choice === 'object' &&
                    settings.tool_choice?.type === 'function' &&
                    settings.tool_choice?.function?.name) {
                    requestParams.tool_choice = {
                        type: settings.tool_choice.type,
                        name: settings.tool_choice.function.name,
                    };
                }
                else if (typeof settings.tool_choice === 'string') {
                    requestParams.tool_choice = settings.tool_choice;
                }
            }
            if (settings?.json_schema?.schema) {
                const { schema, ...wrapperWithoutSchema } = settings.json_schema;
                requestParams.text = {
                    format: {
                        ...wrapperWithoutSchema,
                        schema: processSchemaForOpenAI(schema, undefined, 'json_schema'),
                    },
                };
            }
            if (settings?.verbosity) {
                requestParams.verbosity = settings.verbosity;
            }
            if (settings?.service_tier) {
                requestParams.service_tier = settings.service_tier;
            }
            if (tools && tools.length > 0) {
                requestParams = await convertToOpenAITools(requestParams, tools);
            }
            const modelSupportsStreaming = findModel(model)?.features?.streaming !== false;
            if (!modelSupportsStreaming) {
                delete requestParams.stream;
            }
            const loggedRequestId = log_llm_request(agent.agent_id, 'openai', model, requestParams, new Date(), requestId, agent.tags);
            requestId = loggedRequestId;
            const { waitWhilePaused } = await import('../utils/pause_controller.js');
            await waitWhilePaused(100, agent.abortSignal);
            if (!modelSupportsStreaming) {
                const response = await this.client.responses.create(requestParams, {
                    signal: agent.abortSignal,
                });
                if (response.usage) {
                    const usage = response.usage;
                    const calculatedUsage = costTracker.addUsage(normalizeOpenAIResponsesUsage(model, usage));
                    if (!hasEventHandler()) {
                        yield {
                            type: 'cost_update',
                            usage: calculatedUsage,
                        };
                    }
                }
                if (response.status === 'failed' && response.error) {
                    const errorInfo = response.error;
                    log_llm_error(requestId, errorInfo);
                    yield {
                        type: 'error',
                        error: `OpenAI response failed: [${errorInfo.code || 'N/A'}] ${errorInfo.message}`,
                        recoverable: false,
                    };
                }
                else if (response.status === 'incomplete' && response.incomplete_details) {
                    const reason = response.incomplete_details.reason;
                    log_llm_error(requestId, 'OpenAI response incomplete: ' + reason);
                    yield {
                        type: 'error',
                        error: 'OpenAI response incomplete: ' + reason,
                        recoverable: false,
                    };
                }
                else {
                    for (const event of buildEventsFromOpenAIResponse(response)) {
                        yield event;
                    }
                }
                log_llm_response(requestId, response);
                return;
            }
            const stream = await this.client.responses.create(requestParams, {
                signal: agent.abortSignal,
            });
            const messagePositions = new Map();
            const reasoningPositions = new Map();
            const reasoningAggregates = new Map();
            const deltaBuffers = new Map();
            const citationTracker = createCitationTracker();
            const toolCallStates = new Map();
            let suppressIncompleteToolCallFailure = false;
            const events = [];
            try {
                for await (const event of stream) {
                    events.push(event);
                    if (isPaused()) {
                        await waitWhilePaused(100, agent.abortSignal);
                    }
                    if ((event.type === 'response.completed' ||
                        event.type === 'response.failed' ||
                        event.type === 'response.incomplete') &&
                        event.response?.usage) {
                        const calculatedUsage = costTracker.addUsage(normalizeOpenAIResponsesUsage(model, event.response.usage));
                        if (!hasEventHandler()) {
                            yield {
                                type: 'cost_update',
                                usage: calculatedUsage,
                            };
                        }
                    }
                    if (event.type === 'response.in_progress') {
                    }
                    else if (event.type === 'response.completed') {
                    }
                    else if (event.type === 'response.failed' && event.response?.error) {
                        const errorInfo = event.response.error;
                        log_llm_error(requestId, errorInfo);
                        console.error(`Response ${event.response.id} failed: [${errorInfo.code}] ${errorInfo.message}`);
                        yield {
                            type: 'error',
                            error: `OpenAI response  failed: [${errorInfo.code}] ${errorInfo.message}`,
                            recoverable: false,
                        };
                    }
                    else if (event.type === 'response.incomplete' && event.response?.incomplete_details) {
                        const reason = event.response.incomplete_details.reason;
                        log_llm_error(requestId, 'OpenAI response incomplete: ' + reason);
                        console.warn(`Response ${event.response.id} incomplete: ${reason}`);
                        yield {
                            type: 'error',
                            error: 'OpenAI response incomplete: ' + reason,
                            recoverable: false,
                        };
                    }
                    else if (event.type === 'response.output_item.added' && event.item) {
                        if (event.item.type === 'function_call') {
                            if (!toolCallStates.has(event.item.id)) {
                                toolCallStates.set(event.item.id, {
                                    id: event.item.id,
                                    call_id: event.item.call_id,
                                    type: 'function',
                                    function: {
                                        name: event.item.name || '',
                                        arguments: '',
                                    },
                                });
                            }
                            else {
                                console.warn(`Received output_item.added for already tracked function call ID: ${event.item.id}`);
                            }
                        }
                    }
                    else if (event.type === 'response.output_item.done' && event.item) {
                        if (event.item.type === 'reasoning' && !event.item.summary.length) {
                            yield {
                                type: 'message_complete',
                                content: '',
                                message_id: event.item.id + '-0',
                                thinking_content: '',
                            };
                        }
                    }
                    else if (event.type === 'response.content_part.added' && event.part) {
                    }
                    else if (event.type === 'response.content_part.done' && event.part) {
                    }
                    else if (event.type === 'response.output_text.delta' && event.delta) {
                        const itemId = event.item_id;
                        let position = messagePositions.get(itemId) ?? 0;
                        for (const ev of bufferDelta(deltaBuffers, itemId, event.delta, content => ({
                            type: 'message_delta',
                            content,
                            message_id: itemId,
                            order: position++,
                        }))) {
                            yield ev;
                        }
                        messagePositions.set(itemId, position);
                    }
                    else if (event.type === 'response.output_text.annotation.added' &&
                        event.annotation) {
                        const eventData = event;
                        if (eventData.annotation?.type === 'url_citation' && eventData.annotation.url) {
                            const marker = formatCitation(citationTracker, {
                                title: eventData.annotation.title || eventData.annotation.url,
                                url: eventData.annotation.url,
                            });
                            let position = messagePositions.get(eventData.item_id) ?? 0;
                            yield {
                                type: 'message_delta',
                                content: marker,
                                message_id: eventData.item_id,
                                order: position++,
                            };
                            messagePositions.set(eventData.item_id, position);
                        }
                        else {
                        }
                    }
                    else if (event.type === 'response.output_text.done' && event.text !== undefined) {
                        const itemId = event.item_id;
                        let finalText = event.text;
                        if (citationTracker.citations.size > 0) {
                            const footnotes = generateFootnotes(citationTracker);
                            finalText += footnotes;
                        }
                        yield {
                            type: 'message_complete',
                            content: finalText,
                            message_id: itemId,
                        };
                        messagePositions.delete(itemId);
                    }
                    else if (event.type === 'response.refusal.delta' && event.delta) {
                    }
                    else if (event.type === 'response.refusal.done' && event.refusal) {
                        log_llm_error(requestId, 'OpenAI refusal error: ' + event.refusal);
                        console.error(`Refusal for item ${event.item_id}: ${event.refusal}`);
                        yield {
                            type: 'error',
                            error: 'OpenAI refusal error: ' + event.refusal,
                            recoverable: false,
                        };
                    }
                    else if (event.type === 'response.function_call_arguments.delta' && event.delta) {
                        const currentCall = toolCallStates.get(event.item_id);
                        if (currentCall) {
                            currentCall.function.arguments += event.delta;
                        }
                        else {
                            console.warn(`Received function_call_arguments.delta for unknown item_id: ${event.item_id}`);
                        }
                    }
                    else if (event.type === 'response.function_call_arguments.done' &&
                        event.arguments !== undefined) {
                        const currentCall = toolCallStates.get(event.item_id);
                        if (currentCall) {
                            currentCall.function.arguments = event.arguments;
                            yield {
                                type: 'tool_start',
                                tool_call: currentCall,
                            };
                            toolCallStates.delete(event.item_id);
                        }
                        else {
                            console.warn(`Received function_call_arguments.done for unknown or already yielded item_id: ${event.item_id}`);
                        }
                    }
                    else if (event.type === 'response.file_search_call.in_progress') {
                    }
                    else if (event.type === 'response.file_search_call.searching') {
                    }
                    else if (event.type === 'response.file_search_call.completed') {
                    }
                    else if (event.type === 'response.web_search_call.in_progress') {
                    }
                    else if (event.type === 'response.web_search_call.searching') {
                    }
                    else if (event.type === 'response.web_search_call.completed') {
                    }
                    else if (event.type === 'response.reasoning_summary_part.added') {
                    }
                    else if (event.type === 'response.reasoning_summary_part.done') {
                    }
                    else if (event.type === 'response.reasoning_summary_text.delta' && event.delta) {
                        const itemId = event.item_id + '-' + event.summary_index;
                        let position = reasoningPositions.get(itemId) ?? 0;
                        reasoningAggregates.set(itemId, reasoningAggregates.get(itemId) + event.delta);
                        yield {
                            type: 'message_delta',
                            content: '',
                            message_id: itemId,
                            thinking_content: event.delta,
                            order: position++,
                        };
                        reasoningPositions.set(itemId, position);
                    }
                    else if (event.type === 'response.reasoning_summary_text.done' && event.text !== undefined) {
                        const itemId = event.item_id + '-' + event.summary_index;
                        const aggregatedThinking = event.text;
                        yield {
                            type: 'message_complete',
                            content: '',
                            message_id: itemId,
                            thinking_content: aggregatedThinking,
                        };
                        reasoningPositions.delete(itemId);
                        reasoningAggregates.delete(itemId);
                    }
                    else if (event.type === 'error' && event.message) {
                        log_llm_error(requestId, event);
                        console.error(`API Stream Error (${model}): [${event.code || 'N/A'}] ${event.message}`);
                        yield {
                            type: 'error',
                            error: `OpenAI API error (${model}): [${event.code || 'N/A'}] ${event.message}`,
                            recoverable: false,
                        };
                    }
                }
            }
            catch (streamError) {
                log_llm_error(requestId, streamError);
                console.error('Error processing response stream:', streamError);
                const errorEvent = createProviderErrorEvent(streamError, {
                    prefix: `OpenAI stream request error (${model}): `,
                    request_id: requestId,
                    reason: 'request_stream_failed',
                    retryableErrors: agent.retryOptions?.additionalRetryableErrors,
                    retryableStatusCodes: agent.retryOptions?.additionalRetryableStatusCodes,
                });
                suppressIncompleteToolCallFailure = errorEvent.recoverable === true;
                yield errorEvent;
            }
            finally {
                if (toolCallStates.size > 0) {
                    console.warn(`Stream ended with ${toolCallStates.size} incomplete tool call(s).`);
                    if (!suppressIncompleteToolCallFailure) {
                        const incompleteToolNames = Array.from(toolCallStates.values())
                            .map(toolCall => toolCall.function.name)
                            .filter((name) => typeof name === 'string' && name.length > 0);
                        const errorMessage = incompleteToolNames.length > 0
                            ? `OpenAI response ended with incomplete tool call arguments for: ${incompleteToolNames.join(', ')}`
                            : 'OpenAI response ended with incomplete tool call arguments.';
                        log_llm_error(requestId, errorMessage);
                        yield {
                            type: 'error',
                            error: errorMessage,
                            recoverable: false,
                        };
                    }
                    toolCallStates.clear();
                }
                for (const ev of flushBufferedDeltas(deltaBuffers, (id, content) => {
                    let position = messagePositions.get(id) ?? 0;
                    position++;
                    messagePositions.set(id, position);
                    return {
                        type: 'message_delta',
                        content,
                        message_id: id,
                        order: position,
                    };
                })) {
                    yield ev;
                }
                messagePositions.clear();
                log_llm_response(requestId, events);
            }
        }
        catch (error) {
            log_llm_error(requestId, error);
            console.error('Error in OpenAI streaming response:', error);
            yield createProviderErrorEvent(error, {
                prefix: 'OpenAI streaming error: ',
                request_id: requestId,
                reason: 'request_setup_failed',
                retryableErrors: agent.retryOptions?.additionalRetryableErrors,
                retryableStatusCodes: agent.retryOptions?.additionalRetryableStatusCodes,
            });
        }
    }
    async *createTranscription(audio, agent, model, opts) {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        let finalRequestId = requestId;
        const transcriptionModels = [
            REALTIME_WHISPER_MODEL,
            'gpt-4o-transcribe',
            'gpt-4o-mini-transcribe',
            'whisper-1',
        ];
        const isRealtimeWhisper = model === REALTIME_WHISPER_MODEL;
        if (!transcriptionModels.includes(model)) {
            throw new Error(`Model ${model} does not support transcription. Supported models: ${transcriptionModels.join(', ')}`);
        }
        let ws = null;
        let isConnected = false;
        let connectionError = null;
        let resolveSessionConfigured;
        let rejectSessionConfigured;
        try {
            const { WebSocket } = await import('ws');
            const apiKey = this.apiKey || process.env.OPENAI_API_KEY;
            if (!apiKey) {
                throw new Error('Failed to initialize OpenAI transcription. Make sure OPENAI_API_KEY is set.');
            }
            const wsUrl = 'wss://api.openai.com/v1/realtime?intent=transcription';
            ws = new WebSocket(wsUrl, {
                headers: {
                    Authorization: 'Bearer ' + apiKey,
                    ...(isRealtimeWhisper ? {} : { 'OpenAI-Beta': 'realtime=v1' }),
                },
            });
            const transcriptEvents = [];
            let receivedFinalTranscription = false;
            const sessionConfiguredPromise = isRealtimeWhisper
                ? new Promise((resolve, reject) => {
                    resolveSessionConfigured = resolve;
                    rejectSessionConfigured = reject;
                })
                : Promise.resolve();
            const connectionPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 10000);
                ws.on('open', () => {
                    clearTimeout(timeout);
                    isConnected = true;
                    resolve();
                });
                ws.on('error', error => {
                    clearTimeout(timeout);
                    connectionError = error;
                    reject(error);
                });
            });
            ws.on('message', (data) => {
                try {
                    const event = JSON.parse(data.toString());
                    switch (event.type) {
                        case 'transcription_session.created':
                        case 'session.created': {
                            const sessionUpdate = isRealtimeWhisper
                                ? {
                                    type: 'session.update',
                                    session: {
                                        type: 'transcription',
                                        audio: {
                                            input: {
                                                format: {
                                                    type: 'audio/pcm',
                                                    rate: opts?.audioFormat?.sampleRate || 24000,
                                                },
                                                transcription: {
                                                    model,
                                                    language: opts?.language || 'en',
                                                    ...(opts?.delay ? { delay: opts.delay } : {}),
                                                },
                                                turn_detection: null,
                                            },
                                        },
                                    },
                                }
                                : {
                                    type: 'transcription_session.update',
                                    session: {
                                        input_audio_format: opts?.audioFormat?.encoding === 'pcm' ? 'pcm16' : 'pcm16',
                                        input_audio_transcription: {
                                            model: model,
                                            prompt: opts?.prompt || 'You are a helpful assistant.',
                                            language: opts?.language || 'en',
                                        },
                                        turn_detection: opts?.vad === false
                                            ? null
                                            : {
                                                type: 'semantic_vad',
                                            },
                                        input_audio_noise_reduction: opts?.noiseReduction === null
                                            ? null
                                            : {
                                                type: opts?.noiseReduction || 'far_field',
                                            },
                                    },
                                };
                            ws.send(JSON.stringify(sessionUpdate));
                            break;
                        }
                        case 'session.updated': {
                            resolveSessionConfigured?.();
                            break;
                        }
                        case 'conversation.item.input_audio_transcription.delta': {
                            if (model !== 'whisper-1') {
                                const deltaEvent = {
                                    type: 'transcription_turn_delta',
                                    timestamp: new Date().toISOString(),
                                    delta: event.delta,
                                    partial: true,
                                };
                                transcriptEvents.push(deltaEvent);
                            }
                            break;
                        }
                        case 'conversation.item.input_audio_transcription.completed': {
                            const completeText = event.transcript;
                            const turnEvent = {
                                type: 'transcription_turn_complete',
                                timestamp: new Date().toISOString(),
                                text: completeText,
                            };
                            receivedFinalTranscription = true;
                            transcriptEvents.push(turnEvent);
                            break;
                        }
                        case 'input_audio_buffer.speech_started': {
                            const previewEvent = {
                                type: 'transcription_turn_start',
                                timestamp: new Date().toISOString(),
                            };
                            transcriptEvents.push(previewEvent);
                            break;
                        }
                        case 'input_audio_buffer.speech_stopped': {
                            break;
                        }
                        case 'error': {
                            rejectSessionConfigured?.(new Error(event.error?.message || 'Unknown error'));
                            const errorEvent = {
                                type: 'error',
                                timestamp: new Date().toISOString(),
                                error: event.error?.message || 'Unknown error',
                            };
                            transcriptEvents.push(errorEvent);
                            break;
                        }
                    }
                }
                catch (error) {
                    console.error('[OpenAI] Error processing message:', error);
                }
            });
            ws.on('close', () => {
                isConnected = false;
            });
            await connectionPromise;
            await Promise.race([
                sessionConfiguredPromise,
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('OpenAI realtime transcription session update timeout')), 10000);
                }),
            ]);
            const requestParams = {
                model,
                audioFormat: opts?.audioFormat || { encoding: 'pcm16' },
                prompt: opts?.prompt,
                language: opts?.language || 'en',
                vad: opts?.vad !== false,
                noiseReduction: opts?.noiseReduction,
            };
            const loggedRequestId = log_llm_request(agent.agent_id, 'openai', model, requestParams, new Date(), requestId, agent.tags);
            finalRequestId = loggedRequestId;
            const audioStream = normalizeAudioSource(audio);
            const reader = audioStream.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    if (value && ws && isConnected) {
                        const audioEvent = {
                            type: 'input_audio_buffer.append',
                            audio: Buffer.from(value).toString('base64'),
                        };
                        ws.send(JSON.stringify(audioEvent));
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
                if ((opts?.vad === false || isRealtimeWhisper) && ws && isConnected) {
                    ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
                }
                if (isRealtimeWhisper) {
                    const finalDeadline = Date.now() + 5000;
                    while (!receivedFinalTranscription && Date.now() < finalDeadline) {
                        await new Promise(resolve => setTimeout(resolve, 100));
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
                }
                else {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
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
                const completeEvent = {
                    type: 'transcription_complete',
                    timestamp: new Date().toISOString(),
                };
                yield completeEvent;
            }
            finally {
                reader.releaseLock();
                if (ws && ws.readyState === WEBSOCKET_OPEN_STATE) {
                    ws.close();
                }
            }
        }
        catch (error) {
            log_llm_error(finalRequestId, error);
            console.error('[OpenAI] Transcription error:', error);
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
    throw new Error('Invalid audio source type');
}
export const openaiProvider = new OpenAIProvider();
