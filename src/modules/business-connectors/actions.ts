import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {decryptToken} from '../integrations/secrets'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'
import {issuerGuard} from '../../platform/integration-authority'
import {access,link,guard} from './access'
import {mapped} from './context'
import {id,text,cents,demand,type Action} from './model'
import {preview,execute,readback} from './providers/actions'
import {actionOptions} from './options'
import {code} from './providers/http'
export const actions=new Hono<AppEnv>()
const safe=(a:Action)=>({...a,preview:JSON.parse(a.preview_json),result:a.result_json?JSON.parse(a.result_json):null,preview_json:undefined,result_json:undefined})
actions.post(mapped+'/prepare',async c=>{
 const {actor,row,mapped:l}=await link(c);await access(c,'conversations.manage');demand(row,'read');demand(row,'prepare')
 const body=await c.req.json(),kind=text(body.kind,'action'),rawTarget=id(body.target_id),reason=text(body.reason,'reason',2000),requestKey=id(body.request_key),options=actionOptions(kind,body.options);const crm=['hubspot','salesforce'].includes(row.provider),target=crm&&(kind==='edit_fields'||kind==='support_outcome')?((kind==='edit_fields'?(options as any).object:'contact')+':'+rawTarget):rawTarget;let amount=cents(body.amount_cents??0)
 if(!['refund','credit'].includes(kind)&&amount!==0)throw new HTTPException(400,{message:'This action cannot move funds'})
 if(kind==='support_outcome'&&rawTarget!==l.source_id)throw new HTTPException(409,{message:'Outcome target must match the mapped customer'})
 if(amount>row.limit_cents)throw new HTTPException(403,{message:'Action exceeds the configured USD limit'})
 const derived=kind==='change_plan'||(row.provider==='shopify'&&kind==='refund'&&['full','items'].includes((options as any).mode))
 const existing=await c.env.DB.prepare('SELECT * FROM business_actions WHERE connection_id=? AND conversation_id=? AND request_key=?').bind(row.id,l.conversation_id,requestKey).first<Action>()
 if(existing){if(existing.kind!==kind||existing.target_id!==target||(kind==='change_plan'?JSON.parse(existing.preview_json).next_price!==body.price_id:(!derived&&existing.amount_cents!==amount))||existing.reason!==reason||JSON.stringify(JSON.parse(existing.preview_json).input??{})!==JSON.stringify(options))throw new HTTPException(409,{message:'Request identity already belongs to a different action'});return c.json({data:safe(existing)})}
 let prepared;try{prepared=await preview(row,await decryptToken(c.env,actor.projectId,row.token_cipher!),l.source_id,kind,target,amount,reason,kind==='change_plan'?{price_id:id(body.price_id),proration_date:Math.floor(Date.now()/1000)}:options)}catch(error){throw new HTTPException(409,{message:'Preview refused: '+code(error)})}
 if(derived)amount=cents(prepared.amount_cents)
 if(amount>row.limit_cents)throw new HTTPException(403,{message:'Provider preview exceeds the configured USD limit'})
 await access(c,'conversations.manage');const g=guard(c,row,l),now=Date.now(),actionId=crypto.randomUUID()
 try{
 const result=await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO business_actions(id,project_id,conversation_id,connection_id,connection_version,link_version,source_id,request_key,kind,target_id,amount_cents,reason,preview_json,state,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,'prepared',?,? WHERE ${g.sql}`).bind(actionId,actor.projectId,l.conversation_id,row.id,row.version,l.version,l.source_id,requestKey,kind,target,amount,reason,JSON.stringify(prepared),now,now,...g.params),auditStatement(c.env.DB,{projectId:actor.projectId,category:'approval',action:'business.prepared',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'business_action',id:actionId},detail:{kind,amount_cents:amount}},now,{sql:'EXISTS(SELECT 1 FROM business_actions WHERE id=?)',params:[actionId]})])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Connection or customer changed'})
 }catch(error){if(error instanceof HTTPException)throw error;throw new HTTPException(409,{message:'An action on this provider record is already pending; reconcile it first'})}
 return c.json({data:safe((await c.env.DB.prepare('SELECT * FROM business_actions WHERE id=?').bind(actionId).first<Action>())!)},201)
})
async function load(c:any){const current=await link(c),action=await c.env.DB.prepare('SELECT * FROM business_actions WHERE id=? AND project_id=? AND conversation_id=? AND connection_id=?').bind(c.req.param('actionId'),current.actor.projectId,current.mapped.conversation_id,current.row.id).first() as Action|null;if(!action)throw new HTTPException(404);return {...current,action}}
actions.post(mapped+'/actions/:actionId/approve',async c=>{
 const {actor,row,mapped:l,action}=await load(c);await access(c,'refunds.approve');await requireStepUp(c,actor,'business.approve');demand(row,'approve')
 const body=await c.req.json();if(body.confirmed!==true)throw new HTTPException(400,{message:'Review and explicitly approve this exact preview'})
 const authority=await issuerGuard(c.env,{actor,sessionHash:c.get('sessionHash')}),g=guard(c,row,l),now=Date.now()
 const result=await c.env.DB.batch([c.env.DB.prepare(`UPDATE business_actions SET state='approved',approved_by=?,updated_at=? WHERE id=? AND state='prepared' AND connection_version=? AND link_version=? AND amount_cents<=? AND ${g.sql} AND EXISTS(${authority.sql})`).bind(actor.id,now,action.id,row.version,l.version,row.limit_cents,...g.params,...authority.params),auditStatement(c.env.DB,{projectId:actor.projectId,category:'approval',action:'business.approved',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'business_action',id:action.id},detail:{kind:action.kind,amount_cents:action.amount_cents}},now,{sql:"EXISTS(SELECT 1 FROM business_actions WHERE id=? AND state='approved' AND updated_at=?)",params:[action.id,now]})])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Preview is no longer approvable; prepare again'})
 return c.json({approved:true})
})
actions.post(mapped+'/actions/:actionId/cancel',async c=>{const {actor,action}=await load(c);await access(c,'conversations.manage');await c.env.DB.batch([c.env.DB.prepare("UPDATE business_actions SET state='cancelled',updated_at=? WHERE id=? AND state IN ('prepared','approved')").bind(Date.now(),action.id),auditStatement(c.env.DB,{projectId:actor.projectId,category:'approval',action:'business.cancelled',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'business_action',id:action.id}})]);return c.json({cancelled:true})})
for(const mode of ['execute','reconcile'] as const)actions.post(mapped+'/actions/:actionId/'+mode,async c=>{
 const {actor,row,mapped:l,action}=await load(c);await access(c,'refunds.approve');demand(row,'read');if(mode==='execute')demand(row,'execute')
 if(action.state==='succeeded'||action.state==='failed')return c.json({data:safe(action)})
 if((mode==='execute'&&action.connection_version!==row.version)||action.link_version!==l.version||action.source_id!==l.source_id)throw new HTTPException(409,{message:'Connection or customer changed; action cannot execute or reconcile'})
 const token=await decryptToken(c.env,actor.projectId,row.token_cipher!),g=guard(c,row,l)
 let remoteId=action.remote_id
 if(mode==='execute'){
  await requireStepUp(c,actor,'business.execute');demand(row,'approve')
  if(action.state!=='approved')throw new HTTPException(409,{message:'An approved action may execute once; reconcile an uncertain result'})
  let fresh;try{fresh=await preview(row,token,l.source_id,action.kind,action.target_id,action.amount_cents,action.reason,JSON.parse(action.preview_json))}catch(error){throw new HTTPException(409,{message:'Execution refused: '+code(error)})}
  if(JSON.stringify(fresh)!==action.preview_json)throw new HTTPException(409,{message:'Provider state changed since preview; cancel and prepare again'})
  await access(c,'refunds.approve');const authority=await issuerGuard(c.env,{actor,sessionHash:c.get('sessionHash')})
  const claimed=await c.env.DB.prepare(`UPDATE business_actions SET state='sending',updated_at=? WHERE id=? AND state='approved' AND amount_cents<=? AND ${g.sql} AND EXISTS(${authority.sql})`).bind(Date.now(),action.id,row.limit_cents,...g.params,...authority.params).run()
  if(!claimed.meta.changes)throw new HTTPException(409,{message:'Action already started or authority changed'})
  try{const result=await execute(row,token,action);remoteId=typeof result.id==='string'?result.id:typeof result.data?.id==='string'?result.data.id:null;await c.env.DB.prepare(`UPDATE business_actions SET remote_id=? WHERE id=? AND state='sending' AND ${g.sql}`).bind(remoteId,action.id,...g.params).run()}
  catch(error){await c.env.DB.batch([c.env.DB.prepare("UPDATE business_actions SET state='uncertain',result_json=?,updated_at=? WHERE id=? AND state='sending'").bind(JSON.stringify({code:code(error),notice:'No automatic replay. Reconcile with the provider.'}),Date.now(),action.id),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'business.uncertain',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'business_action',id:action.id},detail:{kind:action.kind,amount_cents:action.amount_cents,code:code(error)}})]);return c.json({state:'uncertain'},202)}
 }else if(!['sending','uncertain'].includes(action.state))throw new HTTPException(409,{message:'Only a started action can reconcile'})
 let result;try{result=await readback(row,token,action,remoteId)}catch(error){result={state:'uncertain',code:code(error),notice:'Provider result remains unconfirmed. No automatic replay.'}}
 await access(c)
 const now=Date.now(),written=await c.env.DB.batch([c.env.DB.prepare(`UPDATE business_actions SET state=?,result_json=?,updated_at=? WHERE id=? AND state IN ('sending','uncertain') AND ${g.sql}`).bind(result.state,JSON.stringify(result),now,action.id,...g.params),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'business.'+result.state,actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'business_action',id:action.id},detail:{kind:action.kind,amount_cents:action.amount_cents}},now,{sql:'EXISTS(SELECT 1 FROM business_actions WHERE id=? AND updated_at=?)',params:[action.id,now]})])
 if(!written[0].meta.changes)throw new HTTPException(409,{message:'Connection, requester or authority changed; check provider without replaying'})
 return c.json({data:safe((await c.env.DB.prepare('SELECT * FROM business_actions WHERE id=?').bind(action.id).first<Action>())!)},result.state==='uncertain'?202:200)
})
