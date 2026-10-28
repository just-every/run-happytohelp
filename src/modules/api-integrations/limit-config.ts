import type {Env} from '../../platform/env'
/** API storage limits use installation configuration independently of rate windows. */
export function uploadLimits(env:Env & {API_UPLOAD_LIMITS?:string}){
 const value=env.API_UPLOAD_LIMITS?JSON.parse(env.API_UPLOAD_LIMITS):{},outstanding=value.outstanding??50
 if(!Number.isSafeInteger(outstanding)||outstanding<1)throw new Error('Invalid outstanding upload limit')
 return {outstanding}
}
