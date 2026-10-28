import type {Env} from '../../../platform/env'
import {starterModels,installedProvider,providerKeyInstalled,type ModelProvider} from '../provisioning/models'
import {modelProvider} from './configuration'

type Seed={name:string;role:string;prompt:string;model:string;is_enabled:unknown}
type Profile={id:string;name:string;role:string;prompt:string;model:string;is_enabled:number}
/** `starter_ai` (BUILD.md I2): the provisioned starter's id and the values it was created with. */
export type StarterMarker={id:string;seed:Seed}

export function starterMarker(settings:any):StarterMarker|null {
 const marker=settings?.starter_ai,seed=marker?.seed
 if(typeof marker?.id!=='string'||!seed||typeof seed!=='object')return null
 return ['name','role','prompt','model'].every(key=>typeof seed[key]==='string')?{id:marker.id,seed}:null
}
/** The owner has not changed anything the starter was created with. */
export const untouched=(profile:Profile,seed:Seed)=>profile.name===seed.name&&profile.role===seed.role&&profile.prompt===seed.prompt&&profile.model===seed.model&&Boolean(profile.is_enabled)===Boolean(seed.is_enabled)
export const starterProfile=(env:Env,projectId:string,id:string)=>env.DB.prepare('SELECT id,name,role,prompt,model,is_enabled FROM ai_profiles WHERE project_id=? AND id=?').bind(projectId,id).first<Profile>()

/** The starter's model on the installed provider: the provisioning table's, for the first provider whose key is installed. */
export function installedStarterModel(env:Env):string|null {
 const provider=installedProvider(env)
 return provider?starterModels[provider].model:null
}
/** Whether the installation holds the key the model's own provider needs. */
const providerKeyHeld=(env:Env,model:string)=>{const provider=modelProvider(model) as ModelProvider;return Object.hasOwn(starterModels,provider)&&providerKeyInstalled(env,provider)}

/**
 * When the untouched starter's provider has no key but another provider's key is installed, move the starter to that
 * provider's model, and its marker with it so it still reads as untouched. Compare-and-set in one batch: an assistant
 * or marker the owner changed since it was read is left exactly as it is. No provider request is made.
 */
export async function reconcileStarter(env:Env,projectId:string,settings:any):Promise<boolean> {
 const marker=starterMarker(settings)
 if(!marker)return false
 const profile=await starterProfile(env,projectId,marker.id)
 if(!profile||!untouched(profile,marker.seed)||providerKeyHeld(env,profile.model))return false
 const model=installedStarterModel(env)
 if(!model||model===profile.model)return false
 const unchanged='EXISTS(SELECT 1 FROM ai_profiles WHERE project_id=? AND id=? AND name=? AND role=? AND prompt=? AND model=? AND is_enabled=?)'
 const current=[projectId,profile.id,profile.name,profile.role,profile.prompt,profile.model,profile.is_enabled]
 const results=await env.DB.batch([
  env.DB.prepare(`UPDATE project_settings SET settings_json=json_set(settings_json,'$.starter_ai.seed.model',?),updated_at=? WHERE project_id=? AND json_extract(settings_json,'$.starter_ai.id')=? AND json_extract(settings_json,'$.starter_ai.seed.model')=? AND ${unchanged}`)
   .bind(model,Date.now(),projectId,marker.id,profile.model,...current),
  env.DB.prepare(`UPDATE ai_profiles SET model=? WHERE project_id=? AND id=? AND name=? AND role=? AND prompt=? AND model=? AND is_enabled=? AND EXISTS(SELECT 1 FROM project_settings WHERE project_id=? AND json_extract(settings_json,'$.starter_ai.id')=? AND json_extract(settings_json,'$.starter_ai.seed.model')=?)`)
   .bind(model,...current,projectId,marker.id,model),
 ])
 return results[1].meta.changes>0
}
