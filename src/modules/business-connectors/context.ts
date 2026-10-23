import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {decryptToken} from '../integrations/secrets'
import {auditStatement,requestSource} from '../audit/record'
import {access,connection,link,guard} from './access'
import {id,demand,hasScope,active,type Connection} from './model'
import {context} from './providers/context'
import {code} from './providers/http'
import {root,publicConnection} from './connections'
export const ticket=root+'/conversations/:conversationId'
export const mapped=ticket+'/connections/:connectionId'
export const contexts=new Hono<AppEnv>()
contexts.get(ticket,async c=>{
 const {actor,conversation}=await access(c)
 const result=await c.env.DB.prepare('SELECT * FROM business_connections WHERE project_id=? ORDER BY provider,account').bind(actor.projectId).all<Connection>()
 const links=await c.env.DB.prepare('SELECT * FROM business_links WHERE project_id=? AND conversation_id=?').bind(actor.projectId,conversation.id).all<any>()
 const actions=await c.env.DB.prepare('SELECT * FROM business_actions WHERE project_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT 50').bind(actor.projectId,conversation.id).all<any>()
 return c.json({data:{connections:result.results.map(row=>{const l=links.results.find(l=>l.connection_id===row.id);return {...publicConnection(row),link:l?{...l,context:hasScope(row,'read')&&l.context_json?JSON.parse(l.context_json):null,context_json:undefined,stale:!hasScope(row,'read')||!!l.error||!l.fetched_at||Date.now()-l.fetched_at>300000}:null}}),actions:actions.results.map(a=>({...a,preview:JSON.parse(a.preview_json),result:a.result_json?JSON.parse(a.result_json):null,preview_json:undefined,result_json:undefined}))}})
})
contexts.post(mapped+'/map',async c=>{
 const {actor,conversation,row}=await connection(c);await access(c,'contacts.manage');demand(row,'read')
 const body=await c.req.json();if(body.confirmed!==true)throw new HTTPException(400,{message:'Confirm the provider customer belongs to this requester; email alone is not identity proof'})
 const source=id(body.source_id)
 // Mapping is explicit; the provider must still confirm the record, never an email guess.
 try{await context(row,await decryptToken(c.env,actor.projectId,row.token_cipher!),source)}catch(error){throw new HTTPException(409,{message:'Customer mapping refused: '+code(error)})}
 const current=await connection(c);demand(current.row,'read');if(current.row.version!==row.version)throw new HTTPException(409,{message:'Connection changed'})
 await access(c,'contacts.manage')
 const saved=await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO business_links(connection_id,project_id,conversation_id,contact_id,source_id) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM business_connections bc JOIN conversations cv ON cv.project_id=bc.project_id JOIN contacts ct ON ct.id=cv.contact_id AND ct.project_id=cv.project_id WHERE bc.id=? AND bc.version=? AND bc.token_cipher IS NOT NULL AND (bc.expires_at IS NULL OR bc.expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) AND cv.id=? AND ${active}) AND (SELECT revision FROM integration_authority_epoch WHERE id=1)=? AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) ON CONFLICT(connection_id,conversation_id) DO UPDATE SET source_id=excluded.source_id,version=business_links.version+1,context_json=NULL,fetched_at=NULL,error=NULL`).bind(row.id,actor.projectId,conversation.id,conversation.contact_id,source,row.id,row.version,conversation.id,row.authority_epoch!,c.get('sessionHash')),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'business.customer_mapped',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'conversation',id:conversation.id},detail:{connection_id:row.id}})])
 if(!saved[0].meta.changes)throw new HTTPException(409,{message:'Customer or workspace authority changed'})
 return c.json({mapped:true})
})
contexts.post(mapped+'/refresh',async c=>{
 const {actor,row,mapped:l}=await link(c);demand(row,'read');const g=guard(c,row,l)
 try{
  const result=await context(row,await decryptToken(c.env,actor.projectId,row.token_cipher!),l.source_id)
  await access(c)
  const written=await c.env.DB.prepare(`UPDATE business_links SET context_json=?,fetched_at=?,error=NULL WHERE connection_id=? AND conversation_id=? AND ${g.sql}`).bind(JSON.stringify(result),Date.now(),row.id,l.conversation_id,...g.params).run()
  if(!written.meta.changes)throw new HTTPException(409,{message:'Connection or customer changed during refresh'})
  return c.json({data:result})
 }catch(error){if(error instanceof HTTPException)throw error;await c.env.DB.prepare(`UPDATE business_links SET error=? WHERE connection_id=? AND conversation_id=? AND ${g.sql}`).bind(code(error),row.id,l.conversation_id,...g.params).run();throw new HTTPException(409,{message:'Refresh unavailable: '+code(error)})}
})
