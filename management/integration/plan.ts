import {validateHappyToHelpVariables} from './environment';
import {normalizePublicMailSettings} from './mail-environment';
import recipe from './recipe.json';
import type {IntegrationHost,ResourcePlan,Environment} from './contract';
function origin(value:unknown,name:string):string {
 if(typeof value!=='string')throw new Error(`${name} required`);
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.port)throw new Error(`${name} must be an HTTPS origin`);
 return url.origin;
}
/** Retained native SQL is trusted service source, never supplied by the browser. */
export function createPlanGenerator({sha256,validatePlan}:IntegrationHost){return async function generateHappyToHelpPlan(installationId:string,environment:Environment,config:Record<string,unknown>):Promise<ResourcePlan> {
 if(!installationId.trim()||!['production','preview'].includes(environment))throw new Error('Invalid installation or environment');
 const publicVariables:Record<string,string>={APP_ORIGIN:origin(config.H2H_PUBLIC_ORIGIN,'H2H_PUBLIC_ORIGIN'),REGISTRATION_ENABLED:'false'};
 for(const key of recipe.variableNames)if(config[key]!==undefined){if(typeof config[key]!=='string')throw new Error(`${key} must be a string`);publicVariables[key]=config[key] as string;}
 publicVariables.RER_MANAGEMENT_ORIGIN=origin(config.RER_MANAGEMENT_ORIGIN,'RER_MANAGEMENT_ORIGIN');
 publicVariables.RER_INSTALLATION_ID=installationId;
 if(typeof config.H2H_SETUP_OWNER_EMAIL!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.H2H_SETUP_OWNER_EMAIL))throw new Error('H2H_SETUP_OWNER_EMAIL required');
 publicVariables.H2H_SETUP_OWNER_EMAIL=config.H2H_SETUP_OWNER_EMAIL.trim().toLowerCase();
 validateHappyToHelpVariables(publicVariables);
 for(const key of recipe.secretNames)if(config[key]!==undefined)throw new Error('Supply secrets only to the delivery broker');
 if(config.secretNames!==undefined&&(!Array.isArray(config.secretNames)||config.secretNames.some(key=>typeof key!=='string'||!recipe.secretNames.includes(key))))throw new Error('Invalid secret names');
 const secretNames=[...new Set(['H2H_SETUP_TOKEN',...(config.secretNames as string[]??[])])];
 const prefix=`rer-${(await sha256(installationId)).slice(0,16)}-${environment==='production'?'prod':'preview'}-`;
 const plan=structuredClone(recipe.plan) as Omit<ResourcePlan,'workerName'|'publicVariables'|'secretNames'>;
 const suffixes:Record<string,string>={DB:'db',FILES:'files',JOBS:'jobs',JOBS_DEAD_LETTER:'jobs-dead'};
 plan.resources=plan.resources.map(resource=>({...resource,name:prefix+suffixes[resource.binding]}));
 plan.environment=environment;
 if(environment==='preview'){
  if(!Array.isArray(config.controlledProviders)||!config.controlledProviders.length||config.controlledProviders.some(value=>typeof value!=='string'||!value.trim()))throw new Error('Preview requires controlledProviders');
  plan.schedules=[];plan.queueConsumers=[];plan.previewEffects={schedulesDisabled:true,controlledProviders:config.controlledProviders as string[]};
 }
 const result:ResourcePlan={...plan,workerName:prefix+'happytohelp',publicVariables:normalizePublicMailSettings(publicVariables),secretNames};
 await validatePlan(result);
 return result;
}

}
