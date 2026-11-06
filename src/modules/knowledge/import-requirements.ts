import type {Env} from '../../platform/env'
import type {ImportPlatform} from './importers'

/** The installation secrets each provider's import signs in with. */
export const importSecrets:Record<ImportPlatform,string[]>={freshdesk:['FRESHDESK_TOKEN'],intercom:['INTERCOM_TOKEN']}
const names:Record<ImportPlatform,string>={freshdesk:'Freshdesk',intercom:'Intercom'}
const list=(values:string[])=>values.length>1?`${values.slice(0,-1).join(', ')} and ${values.at(-1)}`:values[0]

export function missingImportSecrets(env:Env,platform:ImportPlatform){return importSecrets[platform].filter(name=>typeof env[name]!=='string'||!env[name])}

/** A refusal that names the field to fix, in words a support lead can act on. */
export class ImportInputError extends Error{readonly field:'subdomain'|'credentials';constructor(field:'subdomain'|'credentials',message:string){super(message);this.field=field}}

export function checkImportSubdomain(platform:ImportPlatform,subdomain?:string){
 if(platform!=='intercom'&&(!subdomain||!/^[a-z0-9-]+$/i.test(subdomain)))throw new ImportInputError('subdomain',`Subdomain: enter only the first part of your ${names[platform]} address, for example acme for acme.${platform}.com.`)
}
/** Refuses before anything is queued when the provider sign-in is not installed. */
export function checkImportSecrets(env:Env,platform:ImportPlatform){
 const missing=missingImportSecrets(env,platform)
 if(missing.length)throw new ImportInputError('credentials',`${list(missing)} ${missing.length>1?'are':'is'} not set on this installation yet. Follow the steps on this page to add ${missing.length>1?'them':'it'}, then import again.`)
}

/** What a refused provider page means for the person importing. */
export function importPageFailure(platform:ImportPlatform,status:number,origin:string){
 const secrets=list(importSecrets[platform])
 if(status===401||status===403)return `${names[platform]} refused the sign-in (HTTP ${status}). Check ${secrets}.`
 if(status===404)return `Nothing was found at ${origin} (HTTP 404). Check ${platform==='intercom'?'the Intercom token':'the Subdomain'} and that the help center is turned on.`
 if(status===429)return `${names[platform]} asked us to slow down (HTTP 429). Wait a few minutes, then import again.`
 return `${names[platform]} answered HTTP ${status}. Try the import again later.`
}
