import type {Env} from '../../platform/env'
import {canonicaliseFields} from './canonicaliser'
import {tokenPattern,unavailableKnowledge} from './reference-store'

/** Platform jobs have no tenant audience. Detect copies against every project's
 * corpus, then withhold every reference, including public and forged references.
 * No project is inferred from a token or from the source that happened to match. */
export async function unscopedModelInput<T>(env:Env,value:T):Promise<T>{
 return neutralFields(await canonicaliseFields(env,undefined,value))
}

function neutralFields<T>(value:T):T{
 if(typeof value==='string')return value.replace(tokenPattern,unavailableKnowledge) as T
 if(Array.isArray(value))return value.map(neutralFields) as T
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='knowledge_provenance').map(([key,item])=>[key.replace(tokenPattern,unavailableKnowledge),neutralFields(item)])) as T
 return value
}
