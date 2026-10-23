import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {encryptToken} from '../../integrations/secrets'
import {hashToken} from '../../../platform/auth'
import {owner,text,random,revoke,audit,type Connection} from './model'
import {providerUrl} from './provider'

export const enterpriseSettings=new Hono<AppEnv>()
const P='/projects/:projectId/identity-connections'
enterpriseSettings.get(P,async c=>{const actor=await owner(c);const rows=await c.env.DB.prepare('SELECT id,protocol,issuer,config_json,enabled,version FROM enterprise_connections WHERE project_id=?').bind(actor.projectId).all();return c.json({data:rows.results})})
enterpriseSettings.post(P,async c=>{
 const actor=await owner(c,'identity.install'),body=await c.req.json(),protocol=body.protocol
 if(!['oidc','saml'].includes(protocol))throw new HTTPException(400,{message:'Choose OIDC or SAML'})
 const issuer=text(body.issuer,1000),id='idp_'+crypto.randomUUID(),config:any={}
 Object.assign(config,configuration(body,protocol))
 const secret=protocol==='oidc'?await encryptToken(c.env,actor.projectId,text(body.clientSecret,4096)):null,token=random(),now=Date.now()
 const row={id,project_id:actor.projectId} as Connection
 await c.env.DB.batch([c.env.DB.prepare('INSERT INTO enterprise_connections(id,project_id,protocol,issuer,config_json,secret_cipher,scim_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,actor.projectId,protocol,issuer,JSON.stringify(config),secret,await hashToken(token),now,now),audit(c,row,'identity.connection_installed',actor.id)])
 c.header('Cache-Control','no-store')
 return c.json({data:{id,protocol,issuer,scimToken:token,scimBase:`${new URL(c.req.url).origin}/api/identity/scim/${id}/v2`,signInUrl:`${new URL(c.req.url).origin}/api/identity/sso/${id}/start`,callbackUrl:`${new URL(c.req.url).origin}/api/identity/sso/${id}/callback`}},201)
})
enterpriseSettings.post(`${P}/:connectionId/token`,async c=>{
 const actor=await owner(c,'identity.rotate'),row=await c.env.DB.prepare('SELECT * FROM enterprise_connections WHERE id=? AND project_id=? AND enabled=1').bind(c.req.param('connectionId'),actor.projectId).first<Connection>();if(!row)throw new HTTPException(404)
 const token=random();await c.env.DB.batch([c.env.DB.prepare('UPDATE enterprise_connections SET scim_hash=?,updated_at=? WHERE id=?').bind(await hashToken(token),Date.now(),row.id),audit(c,row,'identity.scim_rotated',actor.id)])
 c.header('Cache-Control','no-store');return c.json({scimToken:token})
})
enterpriseSettings.delete(`${P}/:connectionId`,async c=>{
 const actor=await owner(c,'identity.remove'),row=await c.env.DB.prepare('SELECT * FROM enterprise_connections WHERE id=? AND project_id=?').bind(c.req.param('connectionId'),actor.projectId).first<Connection>();if(!row)throw new HTTPException(404)
 await c.env.DB.batch([...revoke(c.env.DB,row),c.env.DB.prepare('UPDATE enterprise_connections SET enabled=0,version=version+1,secret_cipher=NULL,scim_hash=NULL,updated_at=? WHERE id=?').bind(Date.now(),row.id),audit(c,row,'identity.connection_removed',actor.id)])
 return c.json({disabled:true})
})

function configuration(body:any,protocol:string){
 const config:any={}
 if(protocol==='oidc'){
  providerUrl(body.issuer);config.clientId=text(body.clientId);for(const key of ['authorizationEndpoint','tokenEndpoint','jwksUri'])config[key]=providerUrl(body[key])
 }else{
  config.entryPoint=providerUrl(body.entryPoint);if(typeof body.certificate!=='string'||body.certificate.length>12000)throw new HTTPException(400);config.certificate=body.certificate.trim()
  if(!/^-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----$/.test(config.certificate))throw new HTTPException(400,{message:'Pin the IdP signing certificate'})
 }
 return config
}

// A restored or disconnected connection must be reconfigured by its native owner.
// Preserve the issuer/subject binding; never reuse it for a different provider.
enterpriseSettings.put(`${P}/:connectionId`,async c=>{
 const actor=await owner(c,'identity.install'),row=await c.env.DB.prepare('SELECT * FROM enterprise_connections WHERE id=? AND project_id=?').bind(c.req.param('connectionId'),actor.projectId).first<Connection>();if(!row)throw new HTTPException(404)
 const body=await c.req.json()
 if(body.protocol!==row.protocol||body.issuer!==row.issuer)throw new HTTPException(409,{message:'Reconfiguration must preserve protocol and issuer'})
 const config=configuration(body,row.protocol),secret=row.protocol==='oidc'?await encryptToken(c.env,actor.projectId,text(body.clientSecret,4096)):null,token=random()
 await c.env.DB.batch([...revoke(c.env.DB,row),c.env.DB.prepare('UPDATE enterprise_connections SET config_json=?,secret_cipher=?,scim_hash=?,enabled=1,version=version+1,updated_at=? WHERE id=?').bind(JSON.stringify(config),secret,await hashToken(token),Date.now(),row.id),audit(c,row,'identity.connection_reconfigured',actor.id)])
 c.header('Cache-Control','no-store');return c.json({scimToken:token,provisioningRequired:true})
})
