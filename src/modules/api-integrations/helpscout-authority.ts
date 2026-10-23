import {HTTPException} from 'hono/http-exception'
import type {Context} from 'hono'
import type {AppEnv} from '../../platform/env'
import {importActor} from '../move-in/routes'
import {authority} from '../move-in/context'
import type {Permission} from '../access/catalogue'

export async function helpScoutActor(c:Context<AppEnv>,permission:Permission){
 const actor=await importActor(c),db=c.env.DB,a=authority(actor)
 // Check the custom role again inside every batch, including after provider I/O.
 const sql=`(${a.sql}) AND (NOT EXISTS(SELECT 1 FROM member_roles WHERE project_id=? AND user_id=?) OR EXISTS(SELECT 1 FROM member_roles mr JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key,json_each(pr.permissions_json) p WHERE mr.project_id=? AND mr.user_id=? AND pr.base='admin' AND p.value=?))`
 const params=[...a.params!,actor.project_id,actor.actor_id,actor.project_id,actor.actor_id,permission]
 const guard=()=>db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN (${sql}) THEN 1 ELSE 0 END`).bind(...params)
 const batch=async(statements:D1PreparedStatement[])=>{
  try{return await db.batch([guard(),...statements,guard(),db.prepare('DELETE FROM ik_d1_assertions')])}
  catch(error){const live=await db.prepare(`SELECT (${sql}) allowed`).bind(...params).first<{allowed:number}>();if(!live?.allowed)throw new HTTPException(403,{message:'Current workspace authority required'});throw error}
 }
 // Reads also require this permission, even though generic role rules classify mutations.
 if(!(await db.prepare(`SELECT (${sql}) allowed`).bind(...params).first<{allowed:number}>())?.allowed)throw new HTTPException(403,{message:'Current workspace authority required'})
 return {actor,batch}
}

export async function helpScoutBytes(request:Request,limit:number){
 if(Number(request.headers.get('content-length'))>limit)throw new HTTPException(413,{message:'Request too large'})
 const reader=request.body?.getReader();if(!reader)return new Uint8Array()
 const chunks:Uint8Array[]=[];let length=0
 try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>limit){await reader.cancel();throw new HTTPException(413,{message:'Request too large'})}chunks.push(part.value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return bytes
}
