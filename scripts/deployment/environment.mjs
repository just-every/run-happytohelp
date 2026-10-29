/** Runtime bindings selected by native modules. Values never appear in describe/plan output. */
export const secretNames = [
 'OPENAI_API_KEY','ANTHROPIC_API_KEY','GOOGLE_API_KEY','GEMINI_API_KEY',
 'DEEPSEEK_API_KEY','XAI_API_KEY','OPENROUTER_API_KEY','APIFY_TOKEN','QDRANT_API_KEY',
 'INTERCOM_TOKEN','FRESHDESK_TOKEN','ZENDESK_TOKEN','ZENDESK_EMAIL',
 'EMAIL_API_KEY','EMAIL_FROM','INBOUND_EMAIL_TOKEN','MAIL_API_KEY','RER_MAIL_INGRESS_KEY',
 'INTEGRATION_ENCRYPTION_KEY','H2H_SETUP_TOKEN','OWNER_EMAIL',
 'GITHUB_CLIENT_SECRET','GITHUB_TOKEN','GITHUB_TOKENS','TURNSTILE_SECRET','FORMS_TURNSTILE_SECRET_KEY',
]
export const variableNames = [
 'EMAIL_PROVIDER','EMAIL_ACCOUNT_ID','INBOUND_EMAIL_DOMAIN',
 'MAIL_PROVIDER','MAIL_FROM','MAIL_RELAY_URL','H2H_RER_MAIL_VERSION','RER_MAILBOX_ID','RER_MAIL_ADDRESS','RER_MAIL_CONTROL_URL',
 'RER_INSTALLATION_ID','RER_MANAGEMENT_ORIGIN','H2H_SETUP_OWNER_EMAIL','WIDGET_ORIGIN','REGISTRATION_ENABLED','LEAD_MODEL','CONTEXT_MODEL','KNOWLEDGE_EMBEDDING_MODEL','QDRANT_URL',
 'APIFY_CRAWLER_ACTOR_ID','GITHUB_CLIENT_ID','GITHUB_PROJECT_ID','PREVIEW_ORIGIN',
 'BRAND_IMAGE_MODEL','BRAND_IMAGE_SIZE',
 'BRAND_IMAGE_QUALITY','TRAINING_PRICE_CEILINGS','ENABLE_SYNTHETIC_EVALUATION',
 'RATE_LIMITS','AI_DAILY_CEILINGS','PUBLIC_HELP_HOSTS','FORMS_TURNSTILE_SITE_KEY',
]
/** Native bindings other than the standard database, storage and queue bindings. */
export const serviceBindingNames = []
/** Overridable limit names; defaults live in src/platform/limit-config.ts (tests keep both lists equal). */
export const rateLimitNames=['apiRequestsPerTokenMinute','outboundNoticesPerProjectMinute','widgetSessionsPerIpHour','widgetSessionsPerProjectHour','conversationsPerContactHour','conversationsPerIpHour','conversationsPerProjectHour','messagesPerContactHour','messagesPerConversationMinute','widgetEventsPerContactMinute','uploadsPerContactDay','uploadBytesPerContactDay','uploadsPerProjectDay','uploadBytesPerProjectDay','registrationsPerIpDay','projectsPerIpDay','projectsPerAccountDay']
export const aiCeilingNames=['repliesPerProject','spendUsdPerProject','repliesPerInstallation','contextRunsPerProject']
function validateLimitMap(env,name,keys,fractional=[]){
 if(!configured(env,name))return
 const values=JSON.parse(env[name]);if(!values||Array.isArray(values)||typeof values!=='object')throw new Error(`${name} must be a JSON object`)
 for(const [key,value]of Object.entries(values)){if(!keys.includes(key))throw new Error(`${name} has unknown limit ${key}`);if(typeof value!=='number'||!Number.isFinite(value)||value<=0||!fractional.includes(key)&&!Number.isSafeInteger(value))throw new Error(`${name}.${key} must be a positive ${fractional.includes(key)?'number':'integer'}`)}
}
const configured=(env,name)=>typeof env[name]==='string'&&env[name].trim()!==''
/** The setup's direct choice selects the native adapter, not a mail provider. */
export function deploymentMailEnvironment(env){
 if(env.MAIL_PROVIDER==='rer')return {...env}
 const nativeProviders=['resend','cloudflare','sendgrid']
 if(configured(env,'MAIL_PROVIDER')&&env.MAIL_PROVIDER!=='direct'&&!nativeProviders.includes(env.MAIL_PROVIDER))throw new Error('MAIL_PROVIDER must be direct, resend, cloudflare, sendgrid or rer')
 if(nativeProviders.includes(env.MAIL_PROVIDER)&&configured(env,'EMAIL_PROVIDER')&&env.MAIL_PROVIDER!==env.EMAIL_PROVIDER)throw new Error('Native MAIL_PROVIDER must match EMAIL_PROVIDER')
 const provider=nativeProviders.includes(env.MAIL_PROVIDER)?env.MAIL_PROVIDER:env.EMAIL_PROVIDER
 if(!provider)return {...env,MAIL_PROVIDER:env.MAIL_PROVIDER==='direct'?'':env.MAIL_PROVIDER}
 const paired=(publicName,nativeName)=>{
  if(configured(env,publicName)&&configured(env,nativeName)&&env[publicName]!==env[nativeName])throw new Error(`${publicName} must match ${nativeName}`)
  return configured(env,publicName)?env[publicName]:env[nativeName]
 }
 const sender=paired('MAIL_FROM','EMAIL_FROM'),key=paired('MAIL_API_KEY','EMAIL_API_KEY')
 return {...env,EMAIL_PROVIDER:provider,EMAIL_FROM:sender,EMAIL_API_KEY:key,MAIL_PROVIDER:provider,MAIL_FROM:sender,MAIL_API_KEY:key}
}
export function runtimeVariables(env){validateRuntimeEnvironment(env);env=deploymentMailEnvironment(env);return Object.fromEntries(variableNames.filter(name=>configured(env,name)).map(name=>[name,env[name]]))}
export function runtimeSecrets(env){return Object.fromEntries(secretNames.filter(name=>configured(env,name)).map(name=>[name,env[name]]))}
function validateRemoteMailSelection(env){
 if(env.MAIL_PROVIDER==='rer'){
  for(const name of ['MAIL_FROM','MAIL_RELAY_URL','MAIL_API_KEY','RER_MAILBOX_ID','RER_MAIL_ADDRESS','RER_MAIL_CONTROL_URL','RER_MAIL_INGRESS_KEY','INBOUND_EMAIL_TOKEN','INTEGRATION_ENCRYPTION_KEY'])if(!configured(env,name))throw new Error(`Managed email requires ${name}`)
  if(env.H2H_RER_MAIL_VERSION!=='1'||env.MAIL_FROM.toLowerCase()!==env.RER_MAIL_ADDRESS.toLowerCase())throw new Error('Managed conversation mail requires version 1 and the assigned address')
  for(const name of ['MAIL_RELAY_URL','RER_MAIL_CONTROL_URL']){const url=runtimeUrl(env[name],name);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error(`${name} must be HTTPS without credentials or query parameters`)}
  return
 }
 env=deploymentMailEnvironment(env)
 if(configured(env,'EMAIL_PROVIDER')&&!['resend','cloudflare','sendgrid'].includes(env.EMAIL_PROVIDER))throw new Error('EMAIL_PROVIDER must be resend, cloudflare or sendgrid')
 if(env.EMAIL_PROVIDER==='cloudflare'&&!/^[a-f0-9]{32}$/i.test(env.EMAIL_ACCOUNT_ID||''))throw new Error('Cloudflare email requires EMAIL_ACCOUNT_ID')
 if(configured(env,'EMAIL_PROVIDER'))for(const name of ['EMAIL_API_KEY','EMAIL_FROM'])if(!configured(env,name))throw new Error(`${env.EMAIL_PROVIDER} email requires ${name}`)
}
function runtimeUrl(value,name){
 try{return new URL(value)}catch{throw new Error(`${name} must be a valid URL`)}
}
/** Validate only this invocation's mail choice; saved private settings stay untouched. */
export function validateLocalSetupEnvironment(env){
 if(env.EMAIL_PROVIDER!=='development'){validateRemoteMailSelection(env);return}
 if(env.H2H_LOCAL!=='true'||env.RER_INSTALLATION_ID)throw new Error('Development mail requires trusted local configuration')
 const origin=runtimeUrl(env.APP_ORIGIN||'','Development mail origin');
 if(origin.origin!==env.APP_ORIGIN||origin.protocol!=='http:'||origin.hostname!=='127.0.0.1')throw new Error('Development mail requires an exact loopback HTTP origin')
}
export function validateRuntimeEnvironment(env){
 if(env.H2H_LOCAL==='true')throw new Error('Local development mail configuration cannot be deployed')
 validateRemoteMailSelection(env)
 if(configured(env,'PUBLIC_HELP_HOSTS')){
  const hosts=JSON.parse(env.PUBLIC_HELP_HOSTS)
  if(!hosts||Array.isArray(hosts)||typeof hosts!=='object')throw new Error('PUBLIC_HELP_HOSTS must be an exact hostname/project map')
  for(const [host,project]of Object.entries(hosts)){
   if(host!==host.toLowerCase()||! /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)||typeof project!=='string'||!project||project.trim()!==project||project.length>200)throw new Error('PUBLIC_HELP_HOSTS requires exact lower-case DNS hosts and project ids or slugs')
   if(configured(env,'APP_ORIGIN')&&new URL(env.APP_ORIGIN).hostname===host)throw new Error('The application hostname cannot be a help host')
  }
 }
 if(configured(env,'INBOUND_EMAIL_DOMAIN')&&!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(env.INBOUND_EMAIL_DOMAIN))throw new Error('INBOUND_EMAIL_DOMAIN must be a domain name such as in.example.com')
 for(const name of ['REGISTRATION_ENABLED','ENABLE_SYNTHETIC_EVALUATION'])if(configured(env,name)&&!['true','false'].includes(env[name]))throw new Error(`${name} must be true or false`)
 for(const name of ['APP_ORIGIN','PREVIEW_ORIGIN','RER_MANAGEMENT_ORIGIN','QDRANT_URL'])if(configured(env,name)){const url=runtimeUrl(env[name],name);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error(`${name} must be HTTPS without embedded credentials`);if(name!=='QDRANT_URL'&&(url.pathname!=='/'||url.search||url.port))throw new Error(`${name} must be an origin`)}
 if(configured(env,'PREVIEW_ORIGIN')&&(env.PREVIEW_ORIGIN===env.APP_ORIGIN||env.PREVIEW_ORIGIN===env.H2H_PUBLIC_ORIGIN))throw new Error('Preview must have a separate origin')
 if(configured(env,'TRAINING_PRICE_CEILINGS')){const values=JSON.parse(env.TRAINING_PRICE_CEILINGS);if(!values||Array.isArray(values)||typeof values!=='object')throw new Error('TRAINING_PRICE_CEILINGS must be a model map');for(const value of Object.values(values))if(!value||!Number.isFinite(value.inputPerMillion)||!Number.isFinite(value.outputPerMillion)||value.inputPerMillion<=0||value.outputPerMillion<=0)throw new Error('Training price ceilings require positive per-million input/output rates')}
 validateLimitMap(env,'RATE_LIMITS',rateLimitNames)
 validateLimitMap(env,'AI_DAILY_CEILINGS',aiCeilingNames,['spendUsdPerProject'])
 if(configured(env,'INTEGRATION_ENCRYPTION_KEY')&&Buffer.from(env.INTEGRATION_ENCRYPTION_KEY,'base64').length!==32)throw new Error('INTEGRATION_ENCRYPTION_KEY must encode 32 bytes')
 if(configured(env,'GITHUB_TOKENS')){const values=JSON.parse(env.GITHUB_TOKENS);if(!values||Array.isArray(values)||typeof values!=='object')throw new Error('GITHUB_TOKENS must be a private project/token map')}
}
