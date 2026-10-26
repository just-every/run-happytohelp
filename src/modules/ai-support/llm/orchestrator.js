import * as ensemble from '../vendor/ensemble/worker.js';
import { z, validationMessage } from '../../validation/zod.js';
import { taskModelSettings, calculateTaskCost } from './taskModels.js';
import { TASKS, DEFAULT_MAX_RETRIES, modelForTask, modelLabelForTask } from './modelPolicy.js';
import { openAiMessagesToEnsembleInput, ensembleContentToString, normalizeThinkingOutput, isThinkingCompatibleWithModel } from './normalization.js';
import { closePartialJson } from './partialJson.js';
const loadEnsemble = async () => ensemble;
const log = console;
const buildAgent = async ({ task, tools, jsonSchema, options }) => {
    const ensemble = await loadEnsemble();
    const {
        canRunAgent,
        getProviderFromModel,
    } = ensemble;

    const model = modelForTask(task, options);

    const provider = getProviderFromModel(model);

    const agent = {
        model,
        abortSignal: options?.abortSignal,
        tools: tools || undefined,
        // Keep executed tools available in history, but only advertise actions
        // that remain useful in the next provider round (e.g. one icon lookup).
        ...((tools || []).some(tool => tool.isAvailable) ? {
            async getTools() { return (this.tools || []).filter(tool => !tool.isAvailable || tool.isAvailable()); },
        } : {}),
        maxToolCalls: options?.maxToolCalls ?? 80,
        maxToolCallRoundsPerTurn: options?.maxToolCallRoundsPerTurn ?? 4,
        retryOptions: {
            maxRetries: 0,
        },
        modelSettings: {
            ...(![TASKS.AGENT_REPLY, TASKS.AGENT_SUGGESTIONS].includes(task) ? taskModelSettings(model, task) : {}),
            ...(options?.modelSettings || {}),
            json_schema: jsonSchema || undefined,
        },
        tags: [
            'happytohelp-chat',
            task,
        ],
    };

    const runState = await canRunAgent(agent);
    const canRun = typeof runState === 'boolean' ? runState : runState?.canRun !== false;
    if (!canRun) {
        throw new Error(
            `No LLM provider configured for ${modelLabelForTask(task)} model '${model}' (provider='${provider}'). Add OPENAI_API_KEY to your environment.`
        );
    }

    return agent;
};

const zodSchemaToEnsembleJsonSchema = (schema, responseName) => {
    const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' });
    jsonSchema.title = responseName;

    return {
        type: 'json_schema',
        name: responseName,
        schema: jsonSchema,
        // Strict schemas dramatically improve reliability for required fields.
        // The completed response is validated with Zod; invalid output is reported.
        strict: true,
    };
};

const validateWithZod = (schema, value) => {
    if (!schema || typeof schema.safeParse !== 'function') {
        return { success: true, data: value };
    }
    try {
        return schema.safeParse(value, { reportInput: true });
    } catch (e) {
        return { success: false, error: e };
    }
};

const runStream = async ({
    project_id,
    messages,
    task,
    tag,
    handleChunk,
    tools,
    schema,
    response_name,
    options,
    closeProperties,
    trace,
}) => {
    const ensemble = await loadEnsemble();
    const { ensembleRequest } = ensemble;
    const getModelFromAgent = typeof ensemble.getModelFromAgent === 'function' ? ensemble.getModelFromAgent : null;
    const getProviderFromModel = typeof ensemble.getProviderFromModel === 'function' ? ensemble.getProviderFromModel : null;

    const expectJson = !!(schema && response_name);
    const jsonSchema = expectJson ? zodSchemaToEnsembleJsonSchema(schema, response_name) : null;

    const agent = await buildAgent({ task, tools, jsonSchema, options });
    // Pin a specific model for this request so we can safely decide how to replay stored thinking.
    if (getModelFromAgent) {
        agent.model = await getModelFromAgent(agent, agent.modelClass);
    }

    const selectedModel = agent.model;
    const selectedProvider = getProviderFromModel && selectedModel ? getProviderFromModel(selectedModel) : null;

    let input = openAiMessagesToEnsembleInput(messages);
    if (selectedProvider && selectedModel) {
        input = input.filter((item) => isThinkingCompatibleWithModel(item, selectedModel, selectedProvider));
    }

    const aggregatedModels = new Set();
    const roundUsage = new Map();
    const startedAt = Date.now();
    let firstTokenAt = null;
    const report = (name, value) => {
        if (typeof trace?.[name] === 'function') return trace[name](value);
    };

    let responseText = '';
    let lastDelta = '';
    let finalOutputFromResponseEvent = null;
    let generationError = null;

    const thinkingOutputs = [];

    try {
      const stream = ensembleRequest(input, agent);
      for await (const event of stream) {
        if (trace?.onEvent) await trace.onEvent(event);
        if (['tool_start', 'tool_done'].includes(event.type)) report('onToolCall', event);
        if (event.type === 'error' && event.recoverable === false) generationError = new Error(event.error || 'Provider request failed.');
        switch (event.type) {
            case 'agent_start': {
                const requestId = event.request_id;
                const model = event.agent?.model;
                if (typeof model === 'string') {
                    aggregatedModels.add(model);
                }
                if (requestId && !roundUsage.has(requestId)) {
                    roundUsage.set(requestId, {
                        started_at: new Date().toISOString(),
                        model: typeof model === 'string' ? model : undefined,
                        input_tokens: 0,
                        output_tokens: 0,
                        total_tokens: 0,
                        cached_tokens: 0,
                        cost_max: 0,
                        request_cost: undefined,
                        has_usage_update: false,
                    });
                }
                break;
            }
            case 'cost_update': {
                const usage = event.usage || {};
                const requestId = event.request_id;
                if (typeof usage.model === 'string') {
                    aggregatedModels.add(usage.model);
                }

                if (!requestId) break;
                const current = roundUsage.get(requestId) || {
                    model: undefined,
                    input_tokens: 0,
                    output_tokens: 0,
                    total_tokens: 0,
                    cached_tokens: 0,
                    cost_max: 0,
                    request_cost: undefined,
                    has_usage_update: false,
                };

                roundUsage.set(requestId, {
                    ...current,
                    model: current.model || usage.model,
                    input_tokens: Math.max(current.input_tokens || 0, usage.input_tokens || 0),
                    output_tokens: Math.max(current.output_tokens || 0, usage.output_tokens || 0),
                    total_tokens: Math.max(current.total_tokens || 0, usage.total_tokens || 0),
                    cached_tokens: Math.max(current.cached_tokens || 0, usage.cached_tokens || 0),
                    cache_write_tokens: Math.max(current.cache_write_tokens || 0, usage.cache_write_tokens || 0),
                    cache_write_1h_tokens: Math.max(current.cache_write_1h_tokens || 0, usage.cache_write_1h_tokens || 0),
                    reasoning_tokens: Math.max(current.reasoning_tokens || 0, usage.reasoning_tokens || 0),
                    cost_max: Math.max(current.cost_max || 0, typeof usage.cost === 'number' ? usage.cost : 0),
                    has_usage_update: true,
                });
                break;
            }
            case 'agent_done': {
                const requestId = event.request_id;
                if (!requestId) break;
                const current = roundUsage.get(requestId);
                if (!current) break;

                roundUsage.set(requestId, {
                    ...current,
                    request_cost: typeof event.request_cost === 'number' ? event.request_cost : current.request_cost,
                });
                break;
            }
            case 'message_delta': {
                if (typeof event.content !== 'string') break;
                if (firstTokenAt === null && event.content.length) {
                    firstTokenAt = Date.now() - startedAt;
                    report('onFirstToken', firstTokenAt);
                }
                lastDelta = event.content;
                responseText += event.content;

                if (typeof handleChunk === 'function') {
                    if (expectJson) {
                        const partialJson = closePartialJson(responseText, closeProperties);
                        if (partialJson) {
                            handleChunk(partialJson);
                        }
                    } else {
                        handleChunk({ response: responseText, delta: lastDelta });
                    }
                }
                break;
            }
            case 'message_complete': {
                if (typeof event.content === 'string' && event.content.length > 0) {
                    responseText = event.content;
                }
                break;
            }
            case 'response_output': {
                const message = event.message;
                if (message?.type === 'thinking' && message?.role === 'assistant') {
                    const normalized = normalizeThinkingOutput(message);
                    if (normalized) {
                        thinkingOutputs.push(normalized);
                        if (trace && typeof trace.onThinking === 'function') {
                            try {
                                trace.onThinking(normalized);
                            } catch {
                                // ignore tracing errors
                            }
                        }
                    }
                }
                if (message?.type === 'message' && message?.role === 'assistant') {
                    finalOutputFromResponseEvent = ensembleContentToString(message.content);
                }
                break;
            }
        }
      }
    } catch (error) {
        generationError = error;
    }

    if (typeof finalOutputFromResponseEvent === 'string' && finalOutputFromResponseEvent.length > 0) {
        responseText = finalOutputFromResponseEvent;
    }

    let response;
    if (expectJson) {
        // For final outputs, prefer strict parsing. closePartialJson is a recovery mechanism intended
        // mainly for partial streaming.
        try {
            response = JSON.parse(responseText);
        } catch {
            response = null;
        }

        const validation = validateWithZod(schema, response);
        if (validation?.success) {
            response = validation.data;
        }
        else {
            log.warn(`Schema validation failed for '${response_name}' (task='${task}')`, validationMessage(validation?.error));
            response = null;
            generationError = generationError || new Error(`Invalid ${response_name} result: ${validationMessage(validation?.error) || 'schema validation failed'}`);
        }
    } else {
        response = { response: responseText };
    }

    const totals = Array.from(roundUsage.values()).reduce((acc, r) => {
        acc.input_tokens += r.input_tokens || 0;
        acc.output_tokens += r.output_tokens || 0;
        acc.total_tokens += r.total_tokens || 0;
        acc.cached_tokens += r.cached_tokens || 0;
        acc.cache_write_tokens += r.cache_write_tokens || 0;
        acc.cache_write_1h_tokens += r.cache_write_1h_tokens || 0;
        acc.reasoning_tokens += r.reasoning_tokens || 0;
        if (!r.has_usage_update) {
            acc.cost_unknown = true;
            acc.telemetry_error = acc.telemetry_error || 'No provider token usage was received for a completed round.';
            return acc;
        }
        try {
            const verifiedCost = calculateTaskCost(r.model || selectedModel, r, r.started_at || startedAt);
            if (typeof verifiedCost !== 'number') {
                acc.cost_unknown = true;
                acc.telemetry_error = acc.telemetry_error || `No verified pricing is configured for model '${r.model || selectedModel || 'unknown'}'.`;
            }
            else {
                acc.cost += verifiedCost;
                acc.has_verified_cost = true;
            }
        } catch (error) {
            acc.cost_unknown = true;
            acc.telemetry_error = acc.telemetry_error || `Unable to verify usage cost: ${error.message || 'invalid provider usage.'}`;
        }
        return acc;
    }, {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        cached_tokens: 0,
        cache_write_tokens: 0,
        cache_write_1h_tokens: 0,
        reasoning_tokens: 0,
        cost: 0,
        cost_unknown: roundUsage.size === 0,
        has_verified_cost: false,
        telemetry_error: roundUsage.size === 0 ? 'No provider usage events were received.' : null,
    });

    const model = aggregatedModels.size === 1
        ? Array.from(aggregatedModels)[0]
        : aggregatedModels.size > 1
            ? 'ensemble'
            : 'unknown';

    const usage = {
        model,
        cost: totals.cost_unknown || !totals.has_verified_cost ? null : totals.cost,
        cost_unknown: totals.cost_unknown || !totals.has_verified_cost,
        telemetry_error: totals.telemetry_error,
        input_tokens: totals.input_tokens,
        output_tokens: totals.output_tokens,
        total_tokens: totals.total_tokens,
        cached_tokens: totals.cached_tokens,
        cache_write_tokens: totals.cache_write_tokens,
        cache_write_1h_tokens: totals.cache_write_1h_tokens,
        reasoning_tokens: totals.reasoning_tokens,
        metadata: {
            models: Array.from(aggregatedModels),
            task,
        },
    };
    await report('onUsage', { ...usage, latency_ms: Date.now() - startedAt, first_token_ms: firstTokenAt, rounds: Array.from(roundUsage.values()), error: generationError?.message || null });

    if (generationError) throw generationError;

    return response;
};


export { TASKS, runStream };
