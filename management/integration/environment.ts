import {validatePublicMailSettings} from './mail-environment';
/** Shared validation for initial setup and later managed configuration. */
export function validateHappyToHelpVariables(publicVariables:Record<string,string>){
 validatePublicMailSettings(publicVariables);
 for(const key of ['REGISTRATION_ENABLED','ENABLE_SYNTHETIC_EVALUATION'])if(publicVariables[key]&&!['true','false'].includes(publicVariables[key]))throw new Error(`${key} must be true or false`);
 if(publicVariables.PREVIEW_ORIGIN){publicVariables.PREVIEW_ORIGIN=checkedOrigin(publicVariables.PREVIEW_ORIGIN);if(publicVariables.PREVIEW_ORIGIN===publicVariables.APP_ORIGIN)throw new Error('Preview requires separate origin');}
 if(publicVariables.QDRANT_URL){const url=new URL(publicVariables.QDRANT_URL);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('QDRANT_URL must be HTTPS without embedded credentials');}
 if(publicVariables.TRAINING_PRICE_CEILINGS){const values=JSON.parse(publicVariables.TRAINING_PRICE_CEILINGS);if(!values||Array.isArray(values)||typeof values!=='object')throw new Error('Training price ceilings require a model map');for(const value of Object.values(values) as Array<{inputPerMillion:number;outputPerMillion:number}>){if(!value||!Number.isFinite(value.inputPerMillion)||!Number.isFinite(value.outputPerMillion)||value.inputPerMillion<=0||value.outputPerMillion<=0)throw new Error('Training price ceilings require positive rates');}}
 limitMap(publicVariables.RATE_LIMITS,'RATE_LIMITS',rateLimitNames);
 limitMap(publicVariables.AI_DAILY_CEILINGS,'AI_DAILY_CEILINGS',aiCeilingNames,['spendUsdPerProject']);
}

const rateLimitNames=['widgetSessionsPerIpHour','widgetSessionsPerProjectHour','conversationsPerContactHour','conversationsPerIpHour','conversationsPerProjectHour','messagesPerContactHour','messagesPerConversationMinute','widgetEventsPerContactMinute','uploadsPerContactDay','uploadBytesPerContactDay','uploadsPerProjectDay','uploadBytesPerProjectDay','registrationsPerIpDay','projectsPerIpDay','projectsPerAccountDay'];
const aiCeilingNames=['repliesPerProject','spendUsdPerProject','repliesPerInstallation','contextRunsPerProject'];
function limitMap(raw:string|undefined,name:string,keys:string[],fractional:string[]=[]){
 if(!raw)return;
 const values=JSON.parse(raw);if(!values||Array.isArray(values)||typeof values!=='object')throw new Error(`${name} must be a JSON object`);
 for(const [key,value]of Object.entries(values)){if(!keys.includes(key))throw new Error(`${name} has unknown limit ${key}`);if(typeof value!=='number'||!Number.isFinite(value)||value<=0||!fractional.includes(key)&&!Number.isSafeInteger(value))throw new Error(`${name}.${key} must be a positive ${fractional.includes(key)?'number':'integer'}`);}
}

function checkedOrigin(value:string){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.port)throw Error('PREVIEW_ORIGIN must be an HTTPS origin');return url.origin;}
