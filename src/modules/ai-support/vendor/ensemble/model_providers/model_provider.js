import {knowledgeModelProvider} from '../../../../knowledge/model-door';
import {assistProvider} from '../utils/provider_contract.js';
import {ClaudeProvider} from './claude.js';
import {GeminiProvider} from './gemini.js';
import {DeepSeekProvider} from './deepseek.js';
import {GrokProvider} from './grok.js';
import {OpenRouterProvider} from './openrouter.js';
import { OpenAIProvider } from './openai.js';
import { workerRuntime } from '../worker-runtime.js';
import { isExternalModel, getExternalModel, getExternalProvider, getModelClassOverride, } from '../utils/external_models.js';
import { MODEL_CLASSES, MODEL_REGISTRY, findModel } from '../data/model_data.js';

const DEPRECATED_MODEL_MIGRATIONS = {
    'text-embedding-004': 'Model text-embedding-004 was shut down by Google. Migrate to gemini-embedding-2 and regenerate stored embeddings before comparing them with new vectors.',
    'gemini-embedding-exp-03-07': 'Model gemini-embedding-exp-03-07 was shut down by Google. Migrate to gemini-embedding-2 and regenerate stored embeddings before comparing them with new vectors.',
    'deepseek-chat': 'Model deepseek-chat was retired by DeepSeek. Migrate to deepseek-v4-flash and use a disabled reasoning suffix when non-thinking behavior is required.',
    'deepseek-reasoner': 'Model deepseek-reasoner was retired by DeepSeek. Migrate to deepseek-v4-flash or deepseek-v4-pro.',
    'claude-opus-4-1-20250805': 'Model claude-opus-4-1-20250805 was retired by Anthropic. Migrate to claude-opus-5.',
    'claude-opus-4-1': 'Model claude-opus-4-1 was retired by Anthropic. Migrate to claude-opus-5.',
    'claude-opus-4.1': 'Model claude-opus-4.1 was retired by Anthropic. Migrate to claude-opus-5.',
    'claude-4-opus': 'Model claude-4-opus was retired by Anthropic. Migrate to claude-opus-5.',
    'grok-4-1-fast-reasoning': 'Model grok-4-1-fast-reasoning was retired by xAI. Migrate to grok-4.3-low.',
    'grok-4.1-fast-reasoning': 'Model grok-4.1-fast-reasoning was retired by xAI. Migrate to grok-4.3-low.',
    'grok-4-1-fast-non-reasoning': 'Model grok-4-1-fast-non-reasoning was retired by xAI. Migrate to grok-4.3-none.',
    'grok-4.1-fast-non-reasoning': 'Model grok-4.1-fast-non-reasoning was retired by xAI. Migrate to grok-4.3-none.',
    'grok-4-fast-reasoning': 'Model grok-4-fast-reasoning was retired by xAI. Migrate to grok-4.3-low.',
    'grok-4-fast-reasoning-2025-09-01': 'Model grok-4-fast-reasoning-2025-09-01 was retired by xAI. Migrate to grok-4.3-low.',
    'grok-4-fast-non-reasoning': 'Model grok-4-fast-non-reasoning was retired by xAI. Migrate to grok-4.3-none.',
    'grok-4-fast-non-reasoning-2025-09-01': 'Model grok-4-fast-non-reasoning-2025-09-01 was retired by xAI. Migrate to grok-4.3-none.',
    'grok-4-0709': 'Model grok-4-0709 was retired by xAI. Migrate to grok-4.3-low.',
    'grok-3': 'Model grok-3 was retired by xAI. Migrate to grok-4.3-none.',
    'grok-3-2025-02-11': 'Model grok-3-2025-02-11 was retired by xAI. Migrate to grok-4.3-none.',
    'grok-code-fast-1': 'Model grok-code-fast-1 was retired by xAI. Migrate to grok-build-0.1.',
    'gemini-2.0-flash': 'Model gemini-2.0-flash was shut down by Google. Migrate to gemini-3.6-flash.',
    'gemini-2.0-flash-001': 'Model gemini-2.0-flash-001 was shut down by Google. Migrate to gemini-3.6-flash.',
    'gemini-2.0-flash-exp': 'Model gemini-2.0-flash-exp was shut down by Google. Migrate to gemini-3.6-flash.',
    'gemini-2.0-flash-experimental': 'Model gemini-2.0-flash-experimental was shut down by Google. Migrate to gemini-3.6-flash.',
    'gemini-2.0-flash-lite': 'Model gemini-2.0-flash-lite was shut down by Google. Migrate to gemini-3.1-flash-lite.',
    'gemini-2.0-flash-lite-001': 'Model gemini-2.0-flash-lite-001 was shut down by Google. Migrate to gemini-3.1-flash-lite.',
    'gemini-live-2.5-flash-preview': 'Model gemini-live-2.5-flash-preview was shut down by Google. Migrate to gemini-3.1-flash-live-preview.',
    'gemini-2.0-flash-live-001': 'Model gemini-2.0-flash-live-001 was shut down by Google. Migrate to gemini-3.1-flash-live-preview.',
};
function getDeprecatedModelMigration(model) {
    if (!model)
        return undefined;
    if (DEPRECATED_MODEL_MIGRATIONS[model])
        return DEPRECATED_MODEL_MIGRATIONS[model];
    const suffixes = ['-xhigh', '-minimal', '-low', '-medium', '-high', '-none', '-disabled', '-max'];
    const suffix = suffixes.find(candidate => model.endsWith(candidate));
    return suffix ? DEPRECATED_MODEL_MIGRATIONS[model.slice(0, -suffix.length)] : undefined;
}

const selectedProviders={openai:[OpenAIProvider,'OPENAI_API_KEY'],anthropic:[ClaudeProvider,'ANTHROPIC_API_KEY'],google:[GeminiProvider,'GOOGLE_API_KEY'],deepseek:[DeepSeekProvider,'DEEPSEEK_API_KEY'],xai:[GrokProvider,'XAI_API_KEY'],openrouter:[OpenRouterProvider,'OPENROUTER_API_KEY']};
function scopedKey(provider){const r=workerRuntime();return r.settings?.[selectedProviders[provider]?.[1]]||(provider==='google'?r.settings?.GEMINI_API_KEY:provider==='openai'?r.apiKey:undefined)}
export function isProviderKeyValid(provider) { return !!selectedProviders[provider] && !!scopedKey(provider); }
function providerApiKeyName(provider) {
    if (provider === 'fal')
        return 'FAL_KEY';
    if (provider === 'google')
        return 'GOOGLE_API_KEY or GEMINI_API_KEY';
    return `${provider.toUpperCase()}_API_KEY`;
}
export function getProviderFromModel(model) {
    if (getDeprecatedModelMigration(model)) {
        return 'google';
    }
    if (isExternalModel(model)) {
        const externalModel = getExternalModel(model);
        if (externalModel) {
            return externalModel.provider;
        }
    }
    const registeredModel = findModel(model);
    if (registeredModel) {
        return registeredModel.provider;
    }
    if (model.startsWith('gpt-oss-')) {
        return 'openrouter';
    }
    if (model.startsWith('codex-')) {
        return 'codex';
    }
    if (model.startsWith('gpt-') ||
        model.startsWith('o1') ||
        model.startsWith('o3') ||
        model.startsWith('o4') ||
        model.startsWith('text-') ||
        model.startsWith('computer-use-preview') ||
        model.startsWith('dall-e') ||
        model.startsWith('gpt-image') ||
        model.startsWith('tts-')) {
        return 'openai';
    }
    else if (model.startsWith('claude-')) {
        return 'anthropic';
    }
    else if (model.startsWith('gemini-') || model.startsWith('gemma-') || model.startsWith('imagen-')) {
        return 'google';
    }
    else if (model.startsWith('firefly-')) {
        return 'openrouter';
    }
    else if (model.startsWith('replicate-')) {
        return 'runway';
    }
    else if (model.startsWith('flux-') || model.startsWith('fireworks-')) {
        return 'fireworks';
    }
    else if (model.startsWith('stability-') || model.startsWith('sdxl-') || model.startsWith('sd3')) {
        return 'stability';
    }
    else if (model.startsWith('runway-')) {
        return 'runway';
    }
    else if (model.startsWith('runwayml-')) {
        return 'runway';
    }
    else if (model.startsWith('seedream-') || model.startsWith('bytedance-') || model.startsWith('byteplus-')) {
        return 'bytedance';
    }
    else if (model.startsWith('recraft-') || model.startsWith('fal-ai/') || model.startsWith('fal-')) {
        return 'fal';
    }
    else if (model.startsWith('grok-')) {
        return 'xai';
    }
    else if (model.startsWith('deepseek-')) {
        return 'deepseek';
    }
    else if (model.startsWith('eleven_') || model.startsWith('elevenlabs-')) {
        return 'elevenlabs';
    }
    else if (model.startsWith('u3-') || model.startsWith('assemblyai/') || model.startsWith('universal-streaming-')) {
        return 'assemblyai';
    }
    else if (model.startsWith('test-')) {
        return 'test';
    }
    return 'openrouter';
}
function filterModelsWithFallback(models, excludeModels, disabledModels) {
    const allExcluded = [...(excludeModels || []), ...(disabledModels || [])];
    if (allExcluded.length === 0) {
        return models;
    }
    const originalModels = [...models];
    const filteredModels = models.filter(model => !allExcluded.includes(model));
    if (filteredModels.length === 0) {
        const lastUsedModel = [...(excludeModels || [])]
            .reverse()
            .find(excludedModel => originalModels.includes(excludedModel));
        if (lastUsedModel) {
            let nextIndex = (originalModels.indexOf(lastUsedModel) + 1) % originalModels.length;
            let attempts = 0;
            while (attempts < originalModels.length) {
                const nextModel = originalModels[nextIndex];
                if (!disabledModels?.includes(nextModel)) {
                    return [nextModel];
                }
                nextIndex = (nextIndex + 1) % originalModels.length;
                attempts++;
            }
        }
        const firstNonDisabled = originalModels.find(m => !disabledModels?.includes(m));
        if (firstNonDisabled) {
            return [firstNonDisabled];
        }
        if (originalModels.length > 0) {
            return [originalModels[0]];
        }
    }
    return filteredModels;
}
function selectWeightedModel(models, scores) {
    if (!scores || models.length === 0) {
        return models[Math.floor(Math.random() * models.length)];
    }
    const modelWeights = models
        .map(model => ({
        model,
        weight: scores[model] !== undefined ? scores[model] : 50,
    }))
        .filter(m => m.weight > 0);
    if (modelWeights.length === 0) {
        return models[Math.floor(Math.random() * models.length)];
    }
    const totalWeight = modelWeights.reduce((sum, m) => sum + m.weight, 0);
    if (totalWeight === 0) {
        return modelWeights[0].model;
    }
    let random = Math.random() * totalWeight;
    for (const { model, weight } of modelWeights) {
        random -= weight;
        if (random <= 0) {
            return model;
        }
    }
    return modelWeights[0].model;
}
export async function getModelFromAgent(agent, defaultClass, excludeModels) {
    const model = agent.model ||
        (await getModelFromClass(agent.modelClass || defaultClass, excludeModels, agent.disabledModels, agent.modelScores));
    const suffixes = ['-xhigh', '-minimal', '-low', '-medium', '-high', '-none', '-disabled', '-max'];
    const directModelEntry = MODEL_REGISTRY.find(entry => {
        if (entry.id === model)
            return true;
        if (!entry.aliases?.includes(model))
            return false;
        const suffix = suffixes.find(s => model.endsWith(s));
        return !suffix || entry.id.endsWith(suffix);
    });
    if (directModelEntry?.id) {
        return directModelEntry.id;
    }
    let suffix = '';
    let baseModel = model;
    for (const s of suffixes) {
        if (model.endsWith(s)) {
            suffix = s;
            baseModel = model.slice(0, -s.length);
            break;
        }
    }
    const modelEntry = findModel(baseModel);
    if (modelEntry?.id) {
        return modelEntry.id + suffix;
    }
    return model;
}
export async function getModelFromClass(modelClass, excludeModels, disabledModels, modelScores) {
    const { quotaTracker } = await import('../utils/quota_tracker.js');
    const modelClassStr = modelClass;
    const modelGroup = modelClassStr && modelClassStr in MODEL_CLASSES ? modelClassStr : 'standard';
    if (modelGroup in MODEL_CLASSES) {
        const override = getModelClassOverride(modelGroup);
        let modelClassConfig = MODEL_CLASSES[modelGroup];
        if (override) {
            modelClassConfig = {
                ...modelClassConfig,
                ...override,
            };
        }
        let models = [...(override?.models || modelClassConfig.models)];
        models = filterModelsWithFallback(models, excludeModels, disabledModels);
        const shouldRandomize = override?.random ?? ('random' in modelClassConfig && modelClassConfig.random);
        const validModels = [...models];
        const modelsWithKeyAndQuota = validModels.filter(model => {
            const provider = getProviderFromModel(model);
            return isProviderKeyValid(provider) && quotaTracker.hasQuota(provider, model);
        });
        if (modelsWithKeyAndQuota.length > 0) {
            const selectedModel = shouldRandomize && !modelScores
                ? modelsWithKeyAndQuota[Math.floor(Math.random() * modelsWithKeyAndQuota.length)]
                : selectWeightedModel(modelsWithKeyAndQuota, modelScores);
            console.log(`Using '${selectedModel}' model for '${modelGroup}' class.`);
            return selectedModel;
        }
        const modelsWithKey = validModels.filter(model => {
            const provider = getProviderFromModel(model);
            return isProviderKeyValid(provider);
        });
        if (modelsWithKey.length > 0) {
            const selectedModel = shouldRandomize && !modelScores
                ? modelsWithKey[Math.floor(Math.random() * modelsWithKey.length)]
                : selectWeightedModel(modelsWithKey, modelScores);
            console.log(`Using '${selectedModel}' model for '${modelGroup}' class (may exceed quota).`);
            return selectedModel;
        }
    }
    if (modelGroup !== 'standard' && 'standard' in MODEL_CLASSES) {
        let standardModels = MODEL_CLASSES['standard'].models;
        standardModels = filterModelsWithFallback(standardModels, excludeModels, disabledModels);
        const standardModelsWithKeyAndQuota = standardModels.filter(model => {
            const provider = getProviderFromModel(model);
            return isProviderKeyValid(provider) && quotaTracker.hasQuota(provider, model);
        });
        if (standardModelsWithKeyAndQuota.length > 0) {
            const selectedModel = selectWeightedModel(standardModelsWithKeyAndQuota, modelScores);
            console.warn(`Falling back to 'standard' class with model '${selectedModel}'.`);
            return selectedModel;
        }
        const standardModelsWithKey = standardModels.filter(model => {
            const provider = getProviderFromModel(model);
            return isProviderKeyValid(provider);
        });
        if (standardModelsWithKey.length > 0) {
            const selectedModel = selectWeightedModel(standardModelsWithKey, modelScores);
            console.log(`Falling back to 'standard' class with model '${selectedModel}' (may exceed quota).`);
            return selectedModel;
        }
    }
    let defaultModel = 'gpt-5.5';
    if (modelGroup in MODEL_CLASSES) {
        const models = MODEL_CLASSES[modelGroup].models;
        if (models.length > 0) {
            defaultModel = models[0];
        }
    }
    console.log(`No valid API key found for any model in class ${modelGroup}, using default: ${defaultModel}`);
    return defaultModel;
}
export function getModelProvider(model) {
 const runtime=workerRuntime();if(runtime.provider)return knowledgeModelProvider(runtime.provider,runtime);
 const provider=getProviderFromModel(model),selected=selectedProviders[provider];
 if(!selected)throw new Error(`PROVIDER_NOT_SELECTED: ${provider}`);
 const key=scopedKey(provider);if(!key)throw new Error(`CONFIGURATION_REQUIRED: ${selected[1]}`);
 return knowledgeModelProvider(assistProvider(new selected[0](key)),runtime);
}
export async function canRunAgent(agent) {
    if (agent.model) {
        const deprecatedModelMigration = getDeprecatedModelMigration(agent.model);
        if (deprecatedModelMigration) {
            return {
                canRun: false,
                model: agent.model,
                reason: deprecatedModelMigration,
            };
        }
        const provider = getProviderFromModel(agent.model);
        const hasKey = isProviderKeyValid(provider);
        return {
            canRun: hasKey,
            model: agent.model,
            provider,
            missingProvider: hasKey ? undefined : provider,
            reason: hasKey ? undefined : `Missing API key for provider: ${provider}`,
        };
    }
    if (agent.modelClass) {
        const modelClassStr = agent.modelClass;
        const modelGroup = modelClassStr && modelClassStr in MODEL_CLASSES ? modelClassStr : 'standard';
        const override = getModelClassOverride(modelGroup);
        let modelClassConfig = MODEL_CLASSES[modelGroup];
        if (override) {
            modelClassConfig = {
                ...modelClassConfig,
                ...override,
            };
        }
        const models = [...(override?.models || modelClassConfig.models)];
        const availableModels = [];
        const unavailableModels = [];
        const missingProviders = new Set();
        for (const model of models) {
            const provider = getProviderFromModel(model);
            if (isProviderKeyValid(provider)) {
                availableModels.push(model);
            }
            else {
                unavailableModels.push(model);
                missingProviders.add(provider);
            }
        }
        return {
            canRun: availableModels.length > 0,
            availableModels,
            unavailableModels,
            missingProvider: availableModels.length === 0 && missingProviders.size === 1
                ? Array.from(missingProviders)[0]
                : undefined,
            reason: availableModels.length === 0
                ? `No API keys found for any models in class: ${agent.modelClass}. Missing providers: ${Array.from(missingProviders).join(', ')}`
                : undefined,
        };
    }
    return canRunAgent({ modelClass: 'standard' });
}
