import {HTTPException} from 'hono/http-exception'
export const PROVIDERS=['shopify','stripe','orbit','hubspot','salesforce'] as const
export type Provider=typeof PROVIDERS[number]
export const SCOPES=['read','prepare','approve','execute'] as const
export interface Connection {id:string;project_id:string;provider:Provider;account:string;host:string;token_cipher:string|null;scopes_json:string;fields_json:string;limit_cents:number;expires_at:number|null;version:number;updated_at:number;authority_epoch?:number}
export interface Link {connection_id:string;project_id:string;conversation_id:string;contact_id:string;source_id:string;version:number;context_json:string|null;fetched_at:number|null;error:string|null}
export interface Action {id:string;project_id:string;conversation_id:string;connection_id:string;connection_version:number;link_version:number;source_id:string;request_key:string;kind:string;target_id:string;amount_cents:number;reason:string;preview_json:string;state:string;remote_id:string|null;result_json:string|null;approved_by:string|null;created_at:number;updated_at:number}
export function text(value:unknown,label:string,max=200){if(typeof value!=='string'||!value.trim()||value.length>max||/[\r\n\x00]/.test(value))throw new HTTPException(400,{message:`Invalid ${label}`});return value.trim()}
export function id(value:unknown){const result=text(value,'provider record ID');if(!/^[a-zA-Z0-9_:-]+$/.test(result))throw new HTTPException(400,{message:'Invalid provider record ID'});return result}
export function provider(value:unknown):Provider{if(!PROVIDERS.includes(value as Provider))throw new HTTPException(400,{message:'Unsupported business provider'});return value as Provider}
export function hasScope(row:Connection,scope:string){return !!row.token_cipher&&(!row.expires_at||row.expires_at>Date.now())&&JSON.parse(row.scopes_json).includes(scope)}
export function demand(row:Connection,scope:string){if(!hasScope(row,scope))throw new HTTPException(403,{message:`Connection is disconnected, expired or lacks ${scope} scope`})}
export function cents(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>100000000)throw new HTTPException(400,{message:'Use a bounded whole number of USD cents'});return value}
export const active="coalesce(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.is_erased'),0)!=1"
