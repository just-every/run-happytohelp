import type {Env} from '../../../platform/env'
import {assertModelConfigured} from '../../ai-support/configuration'
// @ts-ignore The generation adapter resolves providers from this same registry.
import {getProviderFromModel} from '../../ai-support/vendor/ensemble/model_providers/model_provider.js'

export type ModelProvider = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'xai' | 'openrouter'

/**
 * The starter assistant's model for each provider the installer offers (BUILD.md I7), in the installer's order.
 * Every id is a model registry id (`ai-support/vendor/ensemble/data/model_data.js`) with tool use and streaming,
 * chosen from the provider's low-cost tier because the starter answers visitors on the installation's key.
 */
export const starterModels: Readonly<Record<ModelProvider, {apiKeyEnvironment: string; label: string; model: string}>> = {
 openai: {apiKeyEnvironment: 'OPENAI_API_KEY', label: 'OpenAI', model: 'gpt-5.6-luna'},
 anthropic: {apiKeyEnvironment: 'ANTHROPIC_API_KEY', label: 'Anthropic', model: 'claude-haiku-4-5-20251001'},
 google: {apiKeyEnvironment: 'GOOGLE_API_KEY', label: 'Google', model: 'gemini-3.5-flash-lite'},
 deepseek: {apiKeyEnvironment: 'DEEPSEEK_API_KEY', label: 'DeepSeek', model: 'deepseek-v4-flash'},
 xai: {apiKeyEnvironment: 'XAI_API_KEY', label: 'xAI', model: 'grok-4.3'},
 openrouter: {apiKeyEnvironment: 'OPENROUTER_API_KEY', label: 'OpenRouter', model: 'deepseek/deepseek-v4-flash'},
}
/** With no key installed the starter uses OpenAI's model, so the Setup page names `OPENAI_API_KEY` until a key arrives. */
export const defaultStarterProvider: ModelProvider = 'openai'

const providers = Object.keys(starterModels) as ModelProvider[]
const present = (value: unknown) => typeof value === 'string' && value.trim() !== ''

export function providerKeyInstalled(env: Env, provider: ModelProvider) {
 const model = Object.hasOwn(starterModels, provider) ? starterModels[provider] : undefined
 return Boolean(model && (present(env[model.apiKeyEnvironment]) || (provider === 'google' && present(env.GEMINI_API_KEY))))
}
/** The first provider, in installer order, whose key the installation holds. */
export function installedProvider(env: Env): ModelProvider | null {
 return providers.find(provider => providerKeyInstalled(env, provider)) ?? null
}
export function starterModel(env: Env) {
 return starterModels[installedProvider(env) ?? defaultStarterProvider].model
}

/** True when a generation with this model would reach its provider: the same check generation itself makes. */
export function modelReady(env: Env, model: string) {
 try { assertModelConfigured(env, model); return true } catch { return false }
}
/** Which provider and secret a model needs, and whether the installation holds it. Never key material. */
export function modelReadiness(env: Env, model: string) {
 const provider = String(getProviderFromModel(model))
 const known = providers.includes(provider as ModelProvider) ? starterModels[provider as ModelProvider] : null
 return {provider, providerLabel: known?.label ?? provider, secretName: known?.apiKeyEnvironment ?? null, ready: modelReady(env, model)}
}
