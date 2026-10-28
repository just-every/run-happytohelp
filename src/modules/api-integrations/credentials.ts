import type {Env} from '../../platform/env'
/** Settings accepts the entity id or any of its secrets, including retired ones. */
export async function credentialById(env:Env,project:string,id:string){
 return env.DB.prepare('SELECT * FROM api_credentials WHERE namespace=? AND (id=? OR id=(SELECT credential_id FROM integration_tokens WHERE namespace=? AND id=?))').bind(project,id,project,id).first<any>()
}
export const credentialBindings=(row:any)=>({...JSON.parse(row.reach_json),...JSON.parse(row.values_json)})
export async function resolveBindings(env:Env,project:string,body:any){
 if(!Array.isArray(body.bindings?.credentials))return body
 const ids=[]
 for(const id of body.bindings.credentials){const credential=await credentialById(env,project,id);ids.push(credential?.id??id)}
 return {...body,bindings:{...body.bindings,credentials:[...new Set(ids)]}}
}
