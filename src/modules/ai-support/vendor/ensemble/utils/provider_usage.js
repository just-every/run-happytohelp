import { assertTokenSubset, assertTokenTotal, optionalTokenCount, requiredTokenCount, } from './token_usage_validation.js';
export function normalizeOpenAIResponsesUsage(model, usage) {
    const inputTokens = requiredTokenCount(usage.input_tokens, 'OpenAI usage.input_tokens');
    const outputTokens = requiredTokenCount(usage.output_tokens, 'OpenAI usage.output_tokens');
    const providerTotalTokens = requiredTokenCount(usage.total_tokens, 'OpenAI usage.total_tokens');
    const cachedTokens = requiredTokenCount(usage.input_tokens_details?.cached_tokens, 'OpenAI usage.input_tokens_details.cached_tokens');
    const cacheWriteTokens = requiredTokenCount(usage.input_tokens_details?.cache_write_tokens, 'OpenAI usage.input_tokens_details.cache_write_tokens');
    const reasoningTokens = optionalTokenCount(usage.output_tokens_details?.reasoning_tokens, 'OpenAI usage.output_tokens_details.reasoning_tokens');
    assertTokenTotal('OpenAI usage.total_tokens', providerTotalTokens, [inputTokens, outputTokens]);
    assertTokenSubset('OpenAI cached and cache-write input tokens', cachedTokens + cacheWriteTokens, 'usage.input_tokens', inputTokens);
    assertTokenSubset('OpenAI reasoning tokens', reasoningTokens, 'usage.output_tokens', outputTokens);
    return {
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        cached_tokens: cachedTokens,
        cache_write_tokens: cacheWriteTokens,
        reasoning_tokens: reasoningTokens,
        metadata: {
            // Keep provider evidence separate from normalized accounting fields.
            raw_provider_usage: structuredClone(usage),
            provider_total_tokens: providerTotalTokens,
            reasoning_tokens: reasoningTokens,
        },
    };
}
export function normalizeOpenAIChatUsage(model, usage) {
    const inputTokens = requiredTokenCount(usage.prompt_tokens, 'OpenAI Chat usage.prompt_tokens');
    const outputTokens = requiredTokenCount(usage.completion_tokens, 'OpenAI Chat usage.completion_tokens');
    const providerTotalTokens = requiredTokenCount(usage.total_tokens, 'OpenAI Chat usage.total_tokens');
    const cachedTokens = optionalTokenCount(usage.prompt_tokens_details?.cached_tokens, 'OpenAI Chat usage.prompt_tokens_details.cached_tokens');
    const cacheWriteTokens = optionalTokenCount(usage.prompt_tokens_details?.cache_write_tokens, 'OpenAI Chat usage.prompt_tokens_details.cache_write_tokens');
    const reasoningTokens = optionalTokenCount(usage.completion_tokens_details?.reasoning_tokens, 'OpenAI Chat usage.completion_tokens_details.reasoning_tokens');
    assertTokenTotal('OpenAI Chat usage.total_tokens', providerTotalTokens, [inputTokens, outputTokens]);
    assertTokenSubset('OpenAI Chat cached and cache-write input tokens', cachedTokens + cacheWriteTokens, 'usage.prompt_tokens', inputTokens);
    assertTokenSubset('OpenAI Chat reasoning tokens', reasoningTokens, 'usage.completion_tokens', outputTokens);
    return {
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        cached_tokens: cachedTokens,
        cache_write_tokens: cacheWriteTokens,
        reasoning_tokens: reasoningTokens,
        metadata: {
            raw_provider_usage: structuredClone(usage),
            provider_total_tokens: providerTotalTokens,
            reasoning_tokens: reasoningTokens,
        },
    };
}
export function normalizeGeminiUsage(model, usage) {
    const promptTokens = optionalTokenCount(usage.promptTokenCount, 'Gemini usage.promptTokenCount');
    const toolTokens = optionalTokenCount(usage.toolUsePromptTokenCount, 'Gemini usage.toolUsePromptTokenCount');
    const candidateTokens = optionalTokenCount(usage.candidatesTokenCount, 'Gemini usage.candidatesTokenCount');
    const reasoningTokens = optionalTokenCount(usage.thoughtsTokenCount, 'Gemini usage.thoughtsTokenCount');
    const cachedTokens = optionalTokenCount(usage.cachedContentTokenCount, 'Gemini usage.cachedContentTokenCount');
    const inputTokens = promptTokens + toolTokens;
    const outputTokens = candidateTokens + reasoningTokens;
    const providerTotalTokens = usage.totalTokenCount === undefined || usage.totalTokenCount === null
        ? undefined
        : optionalTokenCount(usage.totalTokenCount, 'Gemini usage.totalTokenCount');
    if (providerTotalTokens !== undefined) {
        assertTokenTotal('Gemini usage.totalTokenCount', providerTotalTokens, [
            promptTokens,
            toolTokens,
            candidateTokens,
            reasoningTokens,
        ]);
    }
    assertTokenSubset('Gemini cached content tokens', cachedTokens, 'usage.promptTokenCount', promptTokens);
    return {
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        cached_tokens: cachedTokens,
        reasoning_tokens: reasoningTokens,
        metadata: {
            raw_provider_usage: structuredClone(usage),
            ...(providerTotalTokens === undefined ? {} : { provider_total_tokens: providerTotalTokens }),
            reasoning_tokens: reasoningTokens,
            tool_tokens: toolTokens,
        },
    };
}
