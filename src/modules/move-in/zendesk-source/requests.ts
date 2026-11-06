import {ZendeskError} from '../zendesk-connection/errors'
import {zendeskFetch} from '../zendesk-connection/http'
import {markReconnect,getConnection} from '../zendesk-connection/store'
import {Deferred,type PullContext} from './context'
/** Zendesk allows 10 incremental export requests a minute. */
export const INCREMENTAL_WINDOW_MS=60000,INCREMENTAL_PER_WINDOW=10
export function incrementalWait(log:number[],now:number){const recent=log.filter(at=>now-at<INCREMENTAL_WINDOW_MS);return recent.length>=INCREMENTAL_PER_WINDOW?recent[recent.length-INCREMENTAL_PER_WINDOW]+INCREMENTAL_WINDOW_MS-now:0}
/** Every source read is a GET to the connection's own subdomain. */
export async function sourceGet(ctx:PullContext,path:string,{incremental=false,missing=false}:{incremental?:boolean;missing?:boolean}={}):Promise<any>{
 const now=Date.now()
 if(incremental){const wait=incrementalWait(ctx.incremental,now);if(wait>0)throw new Deferred(wait)}
 const response=await zendeskFetch(ctx.pull.subdomain,path,{method:'GET',token:ctx.token})
 ctx.requests++
 if(incremental)ctx.incremental=[...ctx.incremental.filter(at=>now-at<INCREMENTAL_WINDOW_MS),now].slice(-INCREMENTAL_PER_WINDOW)
 if(response.status===429)throw new Deferred(1000*(response.retryAfter??60))
 if(response.status===401){const row=await getConnection(ctx.env,ctx.pull.project_id);if(row)await markReconnect(ctx.env,row);throw new ZendeskError('zendesk_reconnect_required',401)}
 if(response.status===403)throw new ZendeskError(incremental?'zendesk_incremental_export_refused':'zendesk_request_refused',403)
 if(response.status===404&&missing)return null
 if(response.status<200||response.status>=300)throw new ZendeskError('zendesk_request_failed',response.status)
 if(!response.data||typeof response.data!=='object'||Array.isArray(response.data))throw new ZendeskError('zendesk_response_invalid',response.status)
 return response.data
}
export const list=(data:any,key:string)=>{const rows=data?.[key];if(!Array.isArray(rows))throw new ZendeskError('zendesk_response_invalid');return rows as any[]}
/** Cursor pages: the next request is built from the cursor value, never a returned link. */
export function afterCursor(data:any):string|null{
 const meta=data?.meta;if(!meta||typeof meta.has_more!=='boolean')throw new ZendeskError('zendesk_response_invalid')
 if(!meta.has_more)return null
 if(typeof meta.after_cursor!=='string'||!meta.after_cursor)throw new ZendeskError('zendesk_response_invalid')
 return meta.after_cursor
}
