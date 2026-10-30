import {hashToken} from '../../platform/auth'
import {requireScope} from './http'
import type {ApiScope,TokenAuthority} from '../../platform/integration-authority'

/** Managed adapters use the native bearer admission, quota and usage audit. */
export async function authorized(c:any,scope:ApiScope,run:(authority:TokenAuthority)=>Promise<Response>){
 let response!:Response
 await requireScope(scope)(c,async()=>{response=await run(c.get('authority'))})
 return response
}
export async function bearerScopes(c:any):Promise<ApiScope[]>{
 const match=/^Bearer (int_[a-f0-9]{64})$/.exec(c.req.header('Authorization')??'')
 if(!match)return []
 const row=await c.env.DB.prepare('SELECT c.scopes FROM integration_tokens t JOIN api_credentials c ON c.namespace=t.namespace AND c.id=t.credential_id WHERE t.token_hash=?').bind(await hashToken(match[1])).first()
 return row?JSON.parse(row.scopes):[]
}
