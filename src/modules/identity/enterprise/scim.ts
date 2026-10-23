import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {scimConnection,text,email,revoke,audit,type Principal} from './model'
const schema='urn:ietf:params:scim:schemas:core:2.0:User'
const resource=(p:Principal)=>({schemas:[schema],id:p.id,externalId:p.external_id,userName:p.user_name,displayName:p.display_name,active:Boolean(p.active),meta:{resourceType:'User'}})
export const scim=new Hono<AppEnv>()
scim.onError((error,c)=>c.json({schemas:['urn:ietf:params:scim:api:messages:2.0:Error'],status:String(error instanceof HTTPException?error.status:500),detail:error instanceof HTTPException?error.message:'Provisioning failed'},error instanceof HTTPException?error.status:500))
scim.use('*',async(c,next)=>{c.header('Content-Type','application/scim+json');c.header('Cache-Control','no-store');await next()})
const P='/scim/:connectionId/v2'
scim.get(`${P}/ServiceProviderConfig`,async c=>{await scimConnection(c);return c.json({schemas:['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],patch:{supported:true},bulk:{supported:false,maxOperations:0,maxPayloadSize:0},filter:{supported:true,maxResults:100},changePassword:{supported:false},sort:{supported:false},etag:{supported:false},authenticationSchemes:[{type:'oauthbearertoken',name:'Bearer token',description:'Owner-issued connection credential'}]})})
scim.get(`${P}/Users`,async c=>{
 const row=await scimConnection(c),filter=c.req.query('filter'),match=filter?.match(/^(userName|externalId) eq "([^"\\]+)"$/)
 if(filter&&!match)throw new HTTPException(400,{message:'Supported filters: userName eq or externalId eq'})
 const start=Number(c.req.query('startIndex')||1),count=Number(c.req.query('count')||100)
 if(!Number.isSafeInteger(start)||start<1||!Number.isSafeInteger(count)||count<0||count>100)throw new HTTPException(400)
 const condition='connection_id=?'+(match?` AND ${match[1]==='userName'?'user_name':'external_id'}=?`:''),params=match?[row.id,match[1]==='userName'?match[2].toLowerCase():match[2]]:[row.id]
 const total=await c.env.DB.prepare(`SELECT count(*) n FROM enterprise_principals WHERE ${condition}`).bind(...params).first<{n:number}>(),items=await c.env.DB.prepare(`SELECT * FROM enterprise_principals WHERE ${condition} ORDER BY id LIMIT ? OFFSET ?`).bind(...params,count,start-1).all<Principal>()
 return c.json({schemas:['urn:ietf:params:scim:api:messages:2.0:ListResponse'],totalResults:total!.n,startIndex:start,itemsPerPage:items.results.length,Resources:items.results.map(resource)})
})
scim.get(`${P}/Users/:principalId`,async c=>{const row=await scimConnection(c),p=await c.env.DB.prepare('SELECT * FROM enterprise_principals WHERE id=? AND connection_id=?').bind(c.req.param('principalId'),row.id).first<Principal>();if(!p)throw new HTTPException(404);return c.json(resource(p))})
scim.post(`${P}/Users`,async c=>{
 const row=await scimConnection(c),body=await c.req.json(),userName=email(body.userName),externalId=text(body.externalId),name=text(body.displayName||body.name?.formatted||userName)
 if(body.active!==undefined&&typeof body.active!=='boolean')throw new HTTPException(400)
 if(body.roles?.length||body.groups?.length||body.password)throw new HTTPException(400,{message:'Roles and credentials are managed by the workspace owner'})
 // Never take over a native account (or a different provider's account) by email.
 if(await c.env.DB.prepare('SELECT 1 FROM users WHERE lower(email)=?').bind(userName).first())throw new HTTPException(409,{message:'An account already uses this email; automatic account linking is refused'})
 const id='principal_'+crypto.randomUUID(),userId='sso_'+crypto.randomUUID(),now=Date.now(),active=body.active===false?0:1
 try{await c.env.DB.batch([
  c.env.DB.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').bind(userId,userName,name,now),
  c.env.DB.prepare('INSERT INTO enterprise_principals VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,row.id,row.project_id,externalId,userId,userName,name,active,now,now),
  ...(active?[c.env.DB.prepare("INSERT INTO memberships VALUES(?,?,'operator')").bind(row.project_id,userId),c.env.DB.prepare("INSERT INTO member_roles VALUES(?,?,'collaborator',?)").bind(row.project_id,userId,now)]:[]),
  audit(c,row,'identity.provisioned',userId),
 ])}catch(error){if(String(error).includes('UNIQUE'))throw new HTTPException(409,{message:'Identity already provisioned'});throw error}
 const p={id,connection_id:row.id,project_id:row.project_id,external_id:externalId,user_id:userId,user_name:userName,display_name:name,active}
 c.header('Location',`${new URL(c.req.url).origin}/api/identity${P.replace(':connectionId',row.id)}/Users/${id}`);return c.json(resource(p),201)
})
for(const method of ['PUT','PATCH','DELETE'] as const)scim.on(method,`${P}/Users/:principalId`,async c=>{
 const row=await scimConnection(c),p=await c.env.DB.prepare('SELECT * FROM enterprise_principals WHERE id=? AND connection_id=?').bind(c.req.param('principalId'),row.id).first<Principal>();if(!p)throw new HTTPException(404)
 let active=false,name=p.display_name
 if(method!=='DELETE'){
  const body=await c.req.json();let update:any=body
  if(method==='PATCH'){
   if(!Array.isArray(body.Operations)||!body.Operations.length||body.Operations.length>10)throw new HTTPException(400)
   update={};for(const op of body.Operations){if(!['replace','add'].includes(String(op.op).toLowerCase()))throw new HTTPException(400);if(op.path){if(!['active','displayName'].includes(op.path))throw new HTTPException(400,{message:'Only active and displayName may change'});update[op.path]=op.value}else{if(!op.value||Object.keys(op.value).some(k=>!['active','displayName'].includes(k)))throw new HTTPException(400);Object.assign(update,op.value)}}
  }
  if(update.userName!==undefined&&email(update.userName)!==p.user_name||update.externalId!==undefined&&update.externalId!==p.external_id||update.roles?.length||update.groups?.length||update.password)throw new HTTPException(409,{message:'Identity binding and authority cannot change through SCIM'})
  if(update.active!==undefined&&typeof update.active!=='boolean')throw new HTTPException(400)
  active=update.active??Boolean(p.active);name=update.displayName===undefined?name:text(update.displayName)
 }
 if(await c.env.DB.prepare("SELECT 1 FROM memberships WHERE project_id=? AND user_id=? AND role='owner'").bind(row.project_id,p.user_id).first())throw new HTTPException(409,{message:'Native owners are never deprovisioned by an IdP'})
 const now=Date.now();await c.env.DB.batch([
  ...(!active?revoke(c.env.DB,row,p.user_id):!p.active?[c.env.DB.prepare("INSERT INTO memberships VALUES(?,?,'operator') ON CONFLICT DO NOTHING").bind(row.project_id,p.user_id),c.env.DB.prepare("INSERT INTO member_roles VALUES(?,?,'collaborator',?) ON CONFLICT(project_id,user_id) DO UPDATE SET role_key='collaborator',assigned_at=excluded.assigned_at").bind(row.project_id,p.user_id,now)]:[]),
  c.env.DB.prepare('UPDATE enterprise_principals SET active=?,display_name=?,updated_at=? WHERE id=?').bind(active?1:0,name,now,p.id),
  c.env.DB.prepare('UPDATE users SET name=? WHERE id=?').bind(name,p.user_id),audit(c,row,active?'identity.updated':'identity.deprovisioned',p.user_id),
 ])
 return method==='DELETE'?c.body(null,204):c.json(resource({...p,active:active?1:0,display_name:name}))
})
