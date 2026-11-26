import { Anthropic } from '@anthropic-ai/sdk/client';
import { v4 as uuidv4 } from 'uuid';
import { createCitationTracker, formatCitation, generateFootnotes } from '../utils/citation_tracker.js';
function formatWebSearchResults(results) {
    if (!Array.isArray(results))
        return '';
    return results
        .filter(r => r.type === 'web_search_result')
        .map((r, i) => `${i + 1}. ${r.title || 'Untitled'} – ${r.url}`)
        .join('\n');
}
import { BaseModelProvider } from './base_provider.js';
import { costTracker } from '../utils/cost_tracker.js';
import { createProviderErrorEvent } from '../utils/failure_detection.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';
import { isPaused } from '../utils/pause_controller.js';
import { findModel } from '../data/model_data.js';
import { appendMessageWithImage, normalizeImageDataUrl } from '../utils/image_utils.js';
import { bufferDelta, flushBufferedDeltas } from '../utils/delta_buffer.js';
import { hasEventHandler } from '../utils/event_controller.js';
import { createAnthropicUsageAccumulator, mergeAnthropicUsage, normalizeAnthropicUsage, } from '../utils/anthropic_usage.js';
const THINKING_BUDGET_CONFIGS = {
    '-low': 0,
    '-medium': 8000,
    '-high': 15000,
    '-max': 30000,
};
const CLAUDE_ADAPTIVE_THINKING_MODEL_IDS = new Set([
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-fable-5',
]);
const CLAUDE_IMPLICIT_ADAPTIVE_THINKING_MODEL_IDS = new Set(['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5']);
const CLAUDE_ADAPTIVE_EFFORT_SUFFIXES = {
    '-none': 'off',
    '-minimal': 'low',
    '-low': 'low',
    '-medium': 'medium',
    '-high': 'high',
    '-xhigh': 'xhigh',
    '-max': 'max',
};
function parseThinkingBudget(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return Math.max(0, Math.floor(value));
}
function mapThinkingBudgetToClaudeAdaptiveEffort(budget) {
    if (budget === 0)
        return 'off';
    if (budget <= 2048)
        return 'low';
    if (budget <= 8192)
        return 'medium';
    if (budget <= 32768)
        return 'high';
    return 'xhigh';
}
function getSuffixedBaseModel(model) {
    const suffixes = [...Object.keys(CLAUDE_ADAPTIVE_EFFORT_SUFFIXES), ...Object.keys(THINKING_BUDGET_CONFIGS)];
    for (const suffix of suffixes) {
        if (model.endsWith(suffix)) {
            return {
                baseModel: model.slice(0, -suffix.length),
                suffix,
            };
        }
    }
    return { baseModel: model, suffix: '' };
}
function getClaudeAdaptiveThinkingModelId(model) {
    const { baseModel } = getSuffixedBaseModel(model);
    const canonicalId = findModel(baseModel)?.id ?? baseModel;
    return CLAUDE_ADAPTIVE_THINKING_MODEL_IDS.has(canonicalId) ? canonicalId : null;
}
function isClaudeAdaptiveThinkingModel(model) {
    return getClaudeAdaptiveThinkingModelId(model) !== null;
}
function contentToString(content) {
    if (content) {
        if (Array.isArray(content)) {
            let results = '';
            for (const eachContent of content) {
                const convertedContent = contentToString(eachContent);
                if (convertedContent.length > 0) {
                    if (results.length > 0) {
                        results += '\n\n';
                    }
                    results += convertedContent;
                }
            }
            return results.trim();
        }
        else if (typeof content === 'string') {
            return content.trim();
        }
        else if (typeof content.text === 'string') {
            return content.text.trim();
        }
        return JSON.stringify(content);
    }
    return '';
}
async function convertContentPartsToClaude(content) {
    if (!Array.isArray(content))
        return [];
    const blocks = [];
    for (const item of content) {
        if (item.type === 'input_text') {
            blocks.push({ type: 'text', text: item.text || '' });
        }
        else if (item.type === 'input_image' || item.type === 'image') {
            const normalized = normalizeImageDataUrl({
                data: 'data' in item ? item.data : undefined,
                image_url: 'image_url' in item ? item.image_url : undefined,
                url: 'url' in item ? item.url : undefined,
                mime_type: 'mime_type' in item ? item.mime_type : undefined,
            });
            if (!normalized.dataUrl) {
                if (normalized.url) {
                    console.warn('Claude image URL inputs are not supported; provide base64 data instead.');
                }
                continue;
            }
            blocks.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: getImageMediaType(normalized.dataUrl),
                    data: cleanBase64Data(normalized.dataUrl),
                },
            });
        }
    }
    return blocks;
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
async function convertToClaudeTools(tools) {
    return await Promise.all(tools.map(async (tool) => {
        if (tool.definition.function.name === 'claude_web_search') {
            return {
                type: 'web_search_20250305',
                name: 'web_search',
            };
        }
        return {
            name: tool.definition.function.name,
            description: tool.definition.function.description,
            input_schema: await resolveAsyncEnums(tool.definition.function.parameters),
        };
    }));
}
function getImageMediaType(imageData) {
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
function cleanBase64Data(imageData) {
    return imageData.replace(/^data:image\/[a-z]+;base64,/, '');
}
function finalizeClaudeToolArguments(currentToolCall) {
    const partialArgs = currentToolCall?.function?._partialArguments;
    if (!partialArgs) {
        return undefined;
    }
    try {
        JSON.parse(partialArgs);
        currentToolCall.function.arguments = partialArgs;
        delete currentToolCall.function._partialArguments;
        return undefined;
    }
    catch (jsonError) {
        console.warn(`Invalid JSON in partial arguments for ${currentToolCall.function.name}: ${partialArgs}`, jsonError);
        if (partialArgs.includes('}{')) {
            const firstBraceIndex = partialArgs.indexOf('{');
            const firstCloseBraceIndex = partialArgs.indexOf('}') + 1;
            if (firstBraceIndex !== -1 && firstCloseBraceIndex > firstBraceIndex) {
                const firstJsonStr = partialArgs.substring(firstBraceIndex, firstCloseBraceIndex);
                try {
                    JSON.parse(firstJsonStr);
                    currentToolCall.function.arguments = firstJsonStr;
                    delete currentToolCall.function._partialArguments;
                    return undefined;
                }
                catch (extractError) {
                    console.error(`Failed to extract valid JSON: ${firstJsonStr}`, extractError);
                }
            }
        }
        delete currentToolCall.function._partialArguments;
        return `Claude emitted malformed tool arguments for ${currentToolCall.function.name}.`;
    }
}
async function addImagesToInput(input, images, source) {
    for (const [image_id, imageData] of Object.entries(images)) {
        const mediaType = getImageMediaType(imageData);
        const cleanedImageData = cleanBase64Data(imageData);
        input.push({
            type: 'text',
            text: `[image #${image_id}] from the ${source}`,
        });
        input.push({
            type: 'image',
            source: {
                type: 'base64',
                media_type: mediaType,
                data: cleanedImageData,
            },
        });
    }
    return input;
}
async function convertToClaudeMessage(model, role, content, msg, result) {
    if (!msg)
        return null;
    if (msg.type === 'function_call') {
        let inputArgs;
        try {
            const argsString = msg.arguments || '{}';
            if (argsString.includes('}{')) {
                console.warn(`Malformed concatenated JSON arguments for ${msg.name}: ${argsString}`);
                const firstBraceIndex = argsString.indexOf('{');
                const firstCloseBraceIndex = argsString.indexOf('}') + 1;
                if (firstBraceIndex !== -1 && firstCloseBraceIndex > firstBraceIndex) {
                    const firstJsonStr = argsString.substring(firstBraceIndex, firstCloseBraceIndex);
                    try {
                        inputArgs = JSON.parse(firstJsonStr);
                        console.log(`Successfully extracted first JSON object: ${firstJsonStr}`);
                    }
                    catch (innerE) {
                        console.error(`Failed to parse extracted JSON: ${firstJsonStr}`, innerE);
                        inputArgs = {};
                    }
                }
                else {
                    inputArgs = {};
                }
            }
            else {
                inputArgs = JSON.parse(argsString);
            }
        }
        catch (e) {
            console.error(`Error parsing function call arguments for ${msg.name}: ${msg.arguments}`, e);
            inputArgs = {};
        }
        const toolUseBlock = {
            type: 'tool_use',
            id: msg.call_id,
            name: msg.name,
            input: inputArgs,
        };
        return { role: 'assistant', content: [toolUseBlock] };
    }
    else if (msg.type === 'function_call_output') {
        const toolResultBlock = {
            type: 'tool_result',
            tool_use_id: msg.call_id,
            content: msg.output || '',
            ...(msg.status === 'incomplete' ? { is_error: true } : {}),
        };
        let contentBlocks = [];
        contentBlocks = await appendMessageWithImage(model, contentBlocks, toolResultBlock, 'content', addImagesToInput, `function call output of ${msg.name}`);
        return { role: 'user', content: contentBlocks };
    }
    else if (msg.type === 'thinking') {
        if (!content) {
            return null;
        }
        if ('signature' in msg && msg.signature) {
            return {
                role: 'assistant',
                content: [
                    {
                        type: 'thinking',
                        thinking: content.trim(),
                        signature: msg.signature,
                    },
                ],
            };
        }
        return { role: 'assistant', content: 'Thinking: ' + content.trim() };
    }
    else {
        if (!content) {
            return null;
        }
        let messageRole = role;
        if (messageRole === 'developer') {
            if (!result?.length) {
                messageRole = 'system';
            }
            else {
                messageRole = 'user';
            }
        }
        if (!['user', 'assistant', 'system'].includes(messageRole)) {
            messageRole = 'user';
        }
        let contentBlocks = [];
        if ('content' in msg && Array.isArray(msg.content)) {
            contentBlocks = await convertContentPartsToClaude(msg.content);
        }
        if (contentBlocks.length === 0) {
            const textBlock = { type: 'text', text: content };
            contentBlocks = await appendMessageWithImage(model, contentBlocks, textBlock, 'text', addImagesToInput, messageRole === 'system' ? 'system prompt' : 'message');
        }
        if (messageRole === 'system') {
            const textContent = contentToString(contentBlocks.filter(block => block.type === 'text'));
            const imageContent = contentBlocks.filter(block => block.type === 'image');
            const systemMsg = { role: 'system', content: textContent };
            if (imageContent.length > 0) {
                const imageMsg = { role: 'user', content: imageContent };
                return [systemMsg, imageMsg];
            }
            else {
                return systemMsg;
            }
        }
        else {
            return { role: messageRole, content: contentBlocks };
        }
    }
}
export class ClaudeProvider extends BaseModelProvider {
    _client;
    apiKey;
    constructor(apiKey) {
        super('anthropic');
        this.apiKey = apiKey;
    }
    get client() {
        if (!this._client) {
            const apiKey = this.apiKey || process.env.ANTHROPIC_API_KEY;
            if (!apiKey) {
                throw new Error('Failed to initialize Claude client. Make sure ANTHROPIC_API_KEY is set.');
            }
            this._client = new Anthropic({
                maxRetries: 0,
                apiKey: apiKey,
            });
        }
        return this._client;
    }
    async prepareClaudeMessages(messages, modelId, thinkingEnabled = false) {
        const result = [];
        const seenToolUseIds = new Set();
        for (const msg of messages) {
            const role = 'role' in msg && msg.role !== 'developer' ? msg.role : 'system';
            let content = '';
            if ('content' in msg) {
                content = contentToString(msg.content);
            }
            const structuredMsg = await convertToClaudeMessage(modelId, role, content, msg, result);
            if (structuredMsg) {
                const msgs = Array.isArray(structuredMsg) ? structuredMsg : [structuredMsg];
                for (const m of msgs) {
                    if (m.role === 'assistant' && Array.isArray(m.content)) {
                        let hasDuplicateToolUse = false;
                        for (const contentBlock of m.content) {
                            if (contentBlock.type === 'tool_use') {
                                if (seenToolUseIds.has(contentBlock.id)) {
                                    console.warn(`Skipping duplicate tool_use ID: ${contentBlock.id}`);
                                    hasDuplicateToolUse = true;
                                    break;
                                }
                                else {
                                    seenToolUseIds.add(contentBlock.id);
                                }
                            }
                        }
                        if (!hasDuplicateToolUse) {
                            result.push(m);
                        }
                    }
                    else {
                        result.push(m);
                    }
                }
            }
        }
        if (thinkingEnabled && result.length > 0) {
            const normalized = [];
            let pendingThinkingBlocks = [];
            const isThinkingBlock = (block) => block?.type === 'thinking' || block?.type === 'redacted_thinking';
            for (const msg of result) {
                if (msg.role !== 'assistant' || !Array.isArray(msg.content)) {
                    pendingThinkingBlocks = [];
                    normalized.push(msg);
                    continue;
                }
                const thinkingBlocks = msg.content.filter(isThinkingBlock).map(block => ({ ...block }));
                const nonThinkingBlocks = msg.content.filter(block => !isThinkingBlock(block));
                if (nonThinkingBlocks.length === 0) {
                    if (thinkingBlocks.length > 0) {
                        pendingThinkingBlocks = [...pendingThinkingBlocks, ...thinkingBlocks];
                    }
                    continue;
                }
                const mergedThinkingBlocks = pendingThinkingBlocks.length > 0 || thinkingBlocks.length > 0
                    ? [...pendingThinkingBlocks, ...thinkingBlocks]
                    : [];
                pendingThinkingBlocks = [];
                msg.content =
                    mergedThinkingBlocks.length > 0
                        ? [...mergedThinkingBlocks, ...nonThinkingBlocks]
                        : nonThinkingBlocks;
                normalized.push(msg);
            }
            result.length = 0;
            result.push(...normalized);
        }
        return result;
    }
    async *createResponseStream(messages, model, agent, requestId) {
        const usageAccumulator = createAnthropicUsageAccumulator();
        let streamCompletedSuccessfully = false;
        let messageCompleteYielded = false;
        try {
            const { getToolsFromAgent } = await import('../utils/agent.js');
            const tools = agent ? await getToolsFromAgent(agent) : [];
            const settings = agent?.modelSettings;
            let headers = undefined;
            if (model.startsWith('claude-sonnet-4') || model.startsWith('claude-opus-4')) {
                headers = {
                    'anthropic-beta': 'interleaved-thinking-2025-05-14',
                };
            }
            let thinking = undefined;
            let outputConfig = undefined;
            let thinkingSet = false;
            const thinkingBudgetFromSettings = parseThinkingBudget(settings?.thinking_budget);
            const isAdaptiveClaude = isClaudeAdaptiveThinkingModel(model);
            let implicitAdaptiveThinking = false;
            if (isAdaptiveClaude) {
                let adaptiveEffort;
                for (const [suffix, effort] of Object.entries(CLAUDE_ADAPTIVE_EFFORT_SUFFIXES)) {
                    if (model.endsWith(suffix)) {
                        adaptiveEffort = effort;
                        model = model.slice(0, -suffix.length);
                        break;
                    }
                }
                if (thinkingBudgetFromSettings !== null) {
                    adaptiveEffort = mapThinkingBudgetToClaudeAdaptiveEffort(thinkingBudgetFromSettings);
                }
                const modelEntry = findModel(model);
                if (modelEntry && CLAUDE_ADAPTIVE_THINKING_MODEL_IDS.has(modelEntry.id)) {
                    model = modelEntry.id;
                }
                implicitAdaptiveThinking = CLAUDE_IMPLICIT_ADAPTIVE_THINKING_MODEL_IDS.has(model);
                if (adaptiveEffort === 'max' && model !== 'claude-opus-5') {
                    adaptiveEffort = 'xhigh';
                }
                thinkingSet = true;
                if (adaptiveEffort === 'off' && model === 'claude-opus-5') {
                    thinking = { type: 'disabled' };
                    implicitAdaptiveThinking = false;
                }
                else if (adaptiveEffort !== 'off') {
                    if (!implicitAdaptiveThinking) {
                        thinking = {
                            type: 'adaptive',
                            display: 'summarized',
                        };
                    }
                    outputConfig = {
                        effort: adaptiveEffort ?? 'high',
                    };
                }
            }
            else {
                for (const [suffix, budget] of Object.entries(THINKING_BUDGET_CONFIGS)) {
                    if (model.endsWith(suffix)) {
                        thinkingSet = true;
                        if (budget > 0) {
                            thinking = {
                                type: 'enabled',
                                budget_tokens: budget,
                            };
                        }
                        model = model.slice(0, -suffix.length);
                        break;
                    }
                }
                if (thinkingBudgetFromSettings !== null) {
                    thinkingSet = true;
                    if (thinkingBudgetFromSettings > 0) {
                        thinking = {
                            type: 'enabled',
                            budget_tokens: thinkingBudgetFromSettings,
                        };
                    }
                    else {
                        thinking = undefined;
                    }
                }
            }
            const canonicalModel = findModel(model);
            if (canonicalModel?.provider === 'anthropic') {
                model = canonicalModel.id;
            }
            if (!headers && (model.startsWith('claude-sonnet-4') || model.startsWith('claude-opus-4'))) {
                headers = {
                    'anthropic-beta': 'interleaved-thinking-2025-05-14',
                };
            }
            const modelData = findModel(model);
            let max_tokens = settings?.max_tokens || modelData?.features?.max_output_tokens || 8192;
            if (modelData?.features?.max_output_tokens) {
                max_tokens = Math.min(max_tokens, modelData.features.max_output_tokens);
            }
            if (!thinkingSet &&
                (model.startsWith('claude-sonnet-4') ||
                    model.startsWith('claude-opus-4') ||
                    model.startsWith('claude-3-7-sonnet'))) {
                thinking = {
                    type: 'enabled',
                    budget_tokens: 8000,
                };
            }
            if (settings?.json_schema) {
                messages.push({
                    type: 'message',
                    role: 'system',
                    content: `Your response MUST be a valid JSON object that conforms to this schema:\n${JSON.stringify(settings.json_schema, null, 2)}`,
                });
            }
            const thinkingEnabled = (thinking !== undefined && thinking.type !== 'disabled') || implicitAdaptiveThinking;
            const requestTemperature = isAdaptiveClaude ? undefined : thinkingEnabled ? 1 : settings?.temperature;
            const claudeMessages = await this.prepareClaudeMessages(messages, model, thinkingEnabled);
            const systemPrompt = claudeMessages.reduce((acc, msg) => {
                if (msg.role === 'system' && msg.content) {
                    if (acc.length > 0) {
                        acc += '\n\n';
                    }
                    acc += contentToString(msg.content);
                }
                return acc;
            }, '');
            const requestParams = {
                model: model,
                messages: claudeMessages.filter(m => m.role === 'user' || m.role === 'assistant'),
                ...(systemPrompt ? { system: systemPrompt.trim() } : {}),
                stream: true,
                max_tokens,
                ...(thinking ? { thinking } : {}),
                ...(outputConfig ? { output_config: outputConfig } : {}),
                ...(requestTemperature !== undefined ? { temperature: requestTemperature } : {}),
            };
            if (tools && tools.length > 0) {
                requestParams.tools = await convertToClaudeTools(tools);
                if (settings?.tool_choice === 'none') requestParams.tool_choice = { type: 'none' };
            }
            if (!requestParams.messages || requestParams.messages.length === 0) {
                console.warn('Claude API Warning: No user or assistant messages provided after filtering. Adding default message.');
                requestParams.messages = [
                    {
                        role: 'user',
                        content: "Let's think this through step by step.",
                    },
                ];
            }
            const loggedRequestId = log_llm_request(agent.agent_id, 'anthropic', model, requestParams, new Date(), requestId, agent.tags);
            requestId = loggedRequestId;
            let currentToolCall = null;
            let toolCallStarted = false;
            let accumulatedSignature = '';
            let accumulatedThinking = '';
            let accumulatedContent = '';
            let finalStopReason = null;
            let finalStopDetails = null;
            const messageId = uuidv4();
            let deltaPosition = 0;
            const deltaBuffers = new Map();
            const citationTracker = createCitationTracker();
            const { waitWhilePaused } = await import('../utils/pause_controller.js');
            await waitWhilePaused(100, agent.abortSignal);
            const stream = await this.client.messages.create(requestParams, {
                ...(headers ? { headers } : {}),
                signal: agent.abortSignal,
            });
            const events = [];
            try {
                for await (const event of stream) {
                    events.push(event);
                    if (isPaused()) {
                        console.log(`[Claude] System paused during stream for model ${model}. Waiting...`);
                        await waitWhilePaused(100, agent.abortSignal);
                        console.log(`[Claude] System resumed, continuing stream for model ${model}`);
                    }
                    if (event.type === 'message_start' && event.message?.usage) {
                        mergeAnthropicUsage(usageAccumulator, event.message.usage);
                    }
                    else if (event.type === 'message_delta' && event.usage) {
                        mergeAnthropicUsage(usageAccumulator, event.usage);
                    }
                    if (event.type === 'message_delta' && event.delta?.stop_reason) {
                        finalStopReason = event.delta.stop_reason;
                        finalStopDetails =
                            event.delta.stop_details ?? null;
                    }
                    if (event.type === 'content_block_delta') {
                        if (event.delta.type === 'signature_delta' && event.delta.signature) {
                            accumulatedSignature += event.delta.signature;
                        }
                        else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
                            yield {
                                type: 'message_delta',
                                content: '',
                                thinking_content: event.delta.thinking,
                                message_id: messageId,
                                order: deltaPosition++,
                            };
                            accumulatedThinking += event.delta.thinking;
                        }
                        else if (event.delta.type === 'text_delta' && event.delta.text) {
                            for (const ev of bufferDelta(deltaBuffers, messageId, event.delta.text, content => ({
                                type: 'message_delta',
                                content,
                                message_id: messageId,
                                order: deltaPosition++,
                            }))) {
                                yield ev;
                            }
                            accumulatedContent += event.delta.text;
                        }
                        else if (event.delta.type === 'input_json_delta' &&
                            currentToolCall &&
                            event.delta.partial_json) {
                            try {
                                if (!currentToolCall.function._partialArguments) {
                                    currentToolCall.function._partialArguments = '';
                                }
                                currentToolCall.function._partialArguments += event.delta.partial_json;
                                yield {
                                    type: 'tool_delta',
                                    tool_call: {
                                        ...currentToolCall,
                                        function: {
                                            ...currentToolCall.function,
                                            arguments: '{}',
                                        },
                                    },
                                };
                            }
                            catch (err) {
                                console.error('Error processing tool_use delta (input_json_delta):', err, event);
                            }
                        }
                        else if (event.delta.type === 'citations_delta' && event.delta.citation) {
                            const citationMarker = formatCitation(citationTracker, {
                                title: event.delta.citation.title,
                                url: event.delta.citation.url,
                                citedText: event.delta.citation.cited_text,
                            });
                            yield {
                                type: 'message_delta',
                                content: citationMarker,
                                message_id: messageId,
                                order: deltaPosition++,
                            };
                            accumulatedContent += citationMarker;
                        }
                    }
                    else if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
                        if (event.content_block.text) {
                            for (const ev of bufferDelta(deltaBuffers, messageId, event.content_block.text, content => ({
                                type: 'message_delta',
                                content,
                                message_id: messageId,
                                order: deltaPosition++,
                            }))) {
                                yield ev;
                            }
                            accumulatedContent += event.content_block.text;
                        }
                    }
                    else if (event.type === 'content_block_stop' && event.content_block?.type === 'text') {
                    }
                    else if (event.type === 'content_block_start' &&
                        event.content_block?.type === 'web_search_tool_result') {
                        if (event.content_block.content) {
                            const formatted = formatWebSearchResults(event.content_block.content);
                            if (formatted) {
                                yield {
                                    type: 'message_delta',
                                    content: '\n\nSearch Results:\n' + formatted + '\n',
                                    message_id: messageId,
                                    order: deltaPosition++,
                                };
                                accumulatedContent += '\n\nSearch Results:\n' + formatted + '\n';
                            }
                        }
                    }
                    else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
                        const toolUse = event.content_block;
                        const toolId = toolUse.id || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                        const toolName = toolUse.name;
                        const toolInput = toolUse.input !== undefined ? toolUse.input : {};
                        currentToolCall = {
                            id: toolId,
                            type: 'function',
                            function: {
                                name: toolName,
                                arguments: typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput),
                            },
                        };
                        toolCallStarted = false;
                    }
                    else if (event.type === 'content_block_stop' &&
                        event.content_block?.type === 'tool_use' &&
                        currentToolCall) {
                        try {
                            const malformedArgumentsError = finalizeClaudeToolArguments(currentToolCall);
                            if (malformedArgumentsError) {
                                log_llm_error(requestId, malformedArgumentsError);
                                yield {
                                    type: 'error',
                                    error: malformedArgumentsError,
                                    recoverable: false,
                                };
                                toolCallStarted = false;
                                currentToolCall = null;
                                continue;
                            }
                            yield {
                                type: 'tool_start',
                                tool_call: currentToolCall,
                            };
                            toolCallStarted = true;
                        }
                        catch (err) {
                            console.error('Error finalizing tool call:', err, event);
                        }
                        finally {
                            currentToolCall = null;
                        }
                    }
                    else if (event.type === 'message_stop') {
                        if (event['amazon-bedrock-invocationMetrics']) {
                            const metrics = event['amazon-bedrock-invocationMetrics'];
                            mergeAnthropicUsage(usageAccumulator, {
                                input_tokens: metrics.inputTokenCount,
                                output_tokens: metrics.outputTokenCount,
                            });
                        }
                        else if (event.usage) {
                            mergeAnthropicUsage(usageAccumulator, event.usage);
                        }
                        if (currentToolCall && !toolCallStarted) {
                            const malformedArgumentsError = finalizeClaudeToolArguments(currentToolCall);
                            if (malformedArgumentsError) {
                                log_llm_error(requestId, malformedArgumentsError);
                                yield {
                                    type: 'error',
                                    error: malformedArgumentsError,
                                    recoverable: false,
                                };
                                currentToolCall = null;
                                toolCallStarted = false;
                                continue;
                            }
                            yield {
                                type: 'tool_start',
                                tool_call: currentToolCall,
                            };
                        }
                        for (const ev of flushBufferedDeltas(deltaBuffers, (_id, content) => ({
                            type: 'message_delta',
                            content,
                            message_id: messageId,
                            order: deltaPosition++,
                        }))) {
                            yield ev;
                        }
                        if (finalStopReason === 'refusal') {
                            const detailParts = [
                                finalStopDetails?.category ? `category: ${finalStopDetails.category}` : null,
                                finalStopDetails?.explanation || null,
                            ].filter(Boolean);
                            const refusalError = `Claude refused the request (stop_reason: refusal` +
                                `${detailParts.length ? `; ${detailParts.join('; ')}` : ''}).`;
                            log_llm_error(requestId, refusalError);
                            yield {
                                type: 'error',
                                error: refusalError,
                                code: 'refusal',
                                details: { stop_reason: finalStopReason, stop_details: finalStopDetails },
                                recoverable: false,
                            };
                            messageCompleteYielded = true;
                        }
                        else if (accumulatedContent || accumulatedThinking) {
                            if (citationTracker.citations.size > 0) {
                                const footnotes = generateFootnotes(citationTracker);
                                accumulatedContent += footnotes;
                            }
                            yield {
                                type: 'message_complete',
                                message_id: messageId,
                                content: accumulatedContent,
                                thinking_content: accumulatedThinking,
                                thinking_signature: accumulatedSignature,
                                ...(finalStopReason ? { stop_reason: finalStopReason } : {}),
                            };
                            messageCompleteYielded = true;
                        }
                        else if (!toolCallStarted && !currentToolCall) {
                            const budgetHint = finalStopReason === 'max_tokens'
                                ? ' The output token budget was exhausted before any text was emitted' +
                                    ' (likely consumed by thinking); increase max_tokens.'
                                : '';
                            const emptyError = `Claude stream ended without content, thinking, or tool calls ` +
                                `(stop_reason: ${finalStopReason ?? 'unknown'}).${budgetHint}`;
                            log_llm_error(requestId, emptyError);
                            yield {
                                type: 'error',
                                error: emptyError,
                                code: finalStopReason === 'max_tokens' ? 'max_tokens_no_output' : 'empty_response',
                                details: { stop_reason: finalStopReason, stop_details: finalStopDetails },
                                recoverable: false,
                            };
                            messageCompleteYielded = true;
                        }
                        streamCompletedSuccessfully = true;
                    }
                    else if (event.type === 'error') {
                        log_llm_error(requestId, event);
                        console.error('Claude API error event:', event.error);
                        yield {
                            type: 'error',
                            error: 'Claude API error: ' +
                                (event.error ? event.error.message || JSON.stringify(event.error) : 'Unknown error'),
                            recoverable: false,
                        };
                        streamCompletedSuccessfully = false;
                        break;
                    }
                }
                if (streamCompletedSuccessfully &&
                    (accumulatedContent || accumulatedThinking) &&
                    !messageCompleteYielded) {
                    console.warn('Stream finished successfully but message_stop might not have triggered message_complete emission. Emitting now.');
                    for (const ev of flushBufferedDeltas(deltaBuffers, (_id, content) => ({
                        type: 'message_delta',
                        content,
                        message_id: messageId,
                        order: deltaPosition++,
                    }))) {
                        yield ev;
                    }
                    if (citationTracker.citations.size > 0) {
                        const footnotes = generateFootnotes(citationTracker);
                        accumulatedContent += footnotes;
                    }
                    yield {
                        type: 'message_complete',
                        message_id: messageId,
                        content: accumulatedContent,
                        thinking_content: accumulatedThinking,
                        thinking_signature: accumulatedSignature,
                        ...(finalStopReason ? { stop_reason: finalStopReason } : {}),
                    };
                    messageCompleteYielded = true;
                }
            }
            catch (streamError) {
                log_llm_error(requestId, streamError);
                console.error('Error processing Claude stream:', streamError);
                yield createProviderErrorEvent(streamError, {
                    prefix: `Claude stream error (${model}): `,
                    request_id: requestId,
                    reason: 'request_stream_failed',
                    retryableErrors: agent.retryOptions?.additionalRetryableErrors,
                    retryableStatusCodes: agent.retryOptions?.additionalRetryableStatusCodes,
                });
            }
            finally {
                log_llm_response(requestId, events);
            }
        }
        catch (error) {
            log_llm_error(requestId, error);
            console.error('Error in Claude streaming completion setup:', error);
            yield createProviderErrorEvent(error, {
                prefix: `Claude request error (${model}): `,
                request_id: requestId,
                reason: 'request_setup_failed',
                retryableErrors: agent.retryOptions?.additionalRetryableErrors,
                retryableStatusCodes: agent.retryOptions?.additionalRetryableStatusCodes,
            });
        }
        finally {
            try {
                const normalizedUsage = normalizeAnthropicUsage(model, usageAccumulator);
                if (normalizedUsage) {
                    const calculatedUsage = costTracker.addUsage(normalizedUsage);
                    if (!hasEventHandler()) {
                        yield {
                            type: 'cost_update',
                            usage: calculatedUsage,
                        };
                    }
                }
            }
            catch (usageError) {
                log_llm_error(requestId, usageError);
                yield {
                    type: 'error',
                    error: `Claude usage accounting error (${model}): ${usageError instanceof Error ? usageError.message : String(usageError)}`,
                    recoverable: false,
                };
            }
        }
    }
}
export const claudeProvider = new ClaudeProvider();
