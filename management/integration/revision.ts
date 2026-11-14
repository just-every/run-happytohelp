import {validateHappyToHelpVariables} from './environment';
import {normalizePublicMailSettings} from './mail-environment';
import recipe from './recipe.json';
import type {ResourcePlan,RevisionInput} from './contract';
export const fixedVariables=['APP_ORIGIN','PREVIEW_ORIGIN','RER_MANAGEMENT_ORIGIN','RER_INSTALLATION_ID','H2H_SETUP_OWNER_EMAIL'];
export async function revisePlan(plan:ResourcePlan,input:RevisionInput){
 const allowed=recipe.variableNames.filter(name=>!fixedVariables.includes(name));
 for(const [name,value]of Object.entries(input.publicVariables??{})){
  if(!allowed.includes(name)&&value!==plan.publicVariables[name])throw Error(`Cannot edit initial or assigned setting ${name}`);
  if(typeof value!=='string'||value.length>16384)throw Error('Invalid runtime value');
 }
 for(const name of allowed){const value=input.publicVariables?.[name];if(value===undefined)continue;if(value)plan.publicVariables[name]=value;else delete plan.publicVariables[name];}
 if(!Array.isArray(input.secretNames)||input.secretNames.some(name=>!recipe.secretNames.includes(name)))throw Error('Invalid provider secret names');
 plan.secretNames=[...new Set([...plan.secretNames,...input.secretNames])];
 validateHappyToHelpVariables(plan.publicVariables);
 plan.publicVariables=normalizePublicMailSettings(plan.publicVariables);
}
