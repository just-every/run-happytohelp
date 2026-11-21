import React from 'react';
import DeveloperHandoff from './DeveloperHandoff';

const providers = {
 OPENAI_API_KEY: ['OpenAI', 'https://platform.openai.com/api-keys'],
 ANTHROPIC_API_KEY: ['Anthropic', 'https://console.anthropic.com/settings/keys'],
 GOOGLE_API_KEY: ['Google AI Studio', 'https://aistudio.google.com/app/apikey'],
 GEMINI_API_KEY: ['Google AI Studio', 'https://aistudio.google.com/app/apikey'],
 DEEPSEEK_API_KEY: ['DeepSeek', 'https://platform.deepseek.com/api_keys'],
 XAI_API_KEY: ['xAI', 'https://console.x.ai'],
 OPENROUTER_API_KEY: ['OpenRouter', 'https://openrouter.ai/settings/keys'],
};
export default function AiKeyHandoff({secretName, installation}) {
 const provider = providers[secretName], name = provider ? secretName : null;
 const keyStep = name ? `Create a key at ${provider[1]}. The selected model needs ${name}.` : 'Check the assistant model on the AI page and create a key at that provider’s website. Use OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, DEEPSEEK_API_KEY, XAI_API_KEY or OPENROUTER_API_KEY to match the model.';
 const local = `For a local installation: open the private .dev.vars file in the HappyToHelp checkout. Add ${name || 'THE_PROVIDER_KEY_NAME'}=your-api-key with the real key kept private. If the start command returned you to the shell, run rer dev --stop && rer dev from that checkout. If you started it with rer dev --foreground, press Ctrl+C in that terminal, then run rer dev --foreground again. Open the RER_OPEN link printed after restart.`;
 const hosted = `For an online installation: in Cloudflare, open Workers & Pages, choose ${installation?.worker || 'the Worker serving this HappyToHelp installation'}, then Settings → Variables and Secrets → Add. Choose Secret, enter ${name || 'the provider key name'} and paste its value privately, then Deploy.`;
 return <DeveloperHandoff what="Connect a key from your AI provider." unlocks="This lets your assistants use that provider. Create the key at your provider’s website; you pay them directly for what’s used."
  subject="Connect our HappyToHelp AI provider" steps={[keyStep, ...(installation ? [installation.environment === 'local' ? local : hosted] : [local, hosted]), 'Reload AI settings and review the assistant and reply mode. Never send the key by email.'].join('\n\n')}/>;
}
