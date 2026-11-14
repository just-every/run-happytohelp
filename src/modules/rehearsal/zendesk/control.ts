import type {Context} from 'hono'
import type {AppEnv} from '../../../platform/env'
import {readBody,parseJson} from '../../legacy-import/package-in/body'
import {LEGACY_LIMITS} from '../../legacy-import/worker-contract'
import {reject} from '../types'
export async function copyControl(c:Context<AppEnv>,keys:string[]=[]){
 const {bytes}=await readBody(c.req.raw,LEGACY_LIMITS.controlBytes,'control_too_large')
 const body=bytes.length?parseJson(bytes,'invalid_request'):{}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!keys.includes(key)))reject('invalid_request',400)
 return body as Record<string,unknown>
}
