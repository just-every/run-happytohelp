import {Hono} from 'hono'
import {bodyLimit} from 'hono/body-limit'
import {shell} from '../public-site/shell'
import {portalCSP,withPortalStyles} from '../public-site/portal-styles'
import {escapeHtml as e} from '../public-site/html'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {submitRequest} from '../forms/index'
import {publishResolution} from '../outcomes/state'
import {portalAccess} from './access'
import {resolvePortalActor} from './identity'
import {portalBody,portalSameOrigin,isPortalForm} from './security'
import {listPortalRequests,portalRequestDetail,replyPortalRequest,reopenPortalRequest} from './requests'
import {attachPortalFile,readPortalFile} from './attachments'
import {readPortalPreferences,savePortalPreferences} from './preferences'

export const portalApi=new Hono<AppEnv>()
portalApi.use('*',bodyLimit({maxSize:21000000,onError:c=>c.json({error:'Choose an attachment up to 20 MB'},413)}))
portalApi.onError((error,c)=>{
 if(error instanceof HTTPException&&c.req.header('Accept')?.includes('text/html')){const projectId=c.req.param('projectId')||'',path=`/portal/${encodeURIComponent(projectId)}`;return c.html(withPortalStyles(shell({name:'Support'},path,`<h1>Unable to complete your request</h1><p>${e(error.message)}</p><p><a href="${e(path)}">Return to your requests</a></p>`,{search:false,noindex:true})),error.status)}
 throw error
})
portalApi.use('*',async(c,next)=>{
 c.header('Content-Security-Policy',portalCSP);c.header('X-Content-Type-Options','nosniff');c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');c.header('Referrer-Policy','no-referrer');c.header('X-Robots-Tag','noindex, nofollow')
 if(!['GET','HEAD','OPTIONS'].includes(c.req.method))portalSameOrigin(c.req.raw)
 await next()
})
portalApi.route('/',portalAccess)
async function access(c:any){const identity=await resolvePortalActor(c.env,c.req.param('projectId'),c.req.raw);if(!identity)throw new HTTPException(401,{message:'Sign in to your support requests'});return identity}
const detailPath=(projectId:string,id:string)=>`/portal/${encodeURIComponent(projectId)}/requests/${encodeURIComponent(id)}`
portalApi.get('/:projectId/tickets',async c=>c.json({tickets:await listPortalRequests(c.env,await access(c),Number(c.req.query('before')))}))
portalApi.post('/:projectId/tickets',async c=>{
 const identity=await access(c),body=await portalBody(c)
 const result=await submitRequest(c.env,{projectId:identity.actor.projectId,formId:body.formId,body,request:c.req.raw,identity,channel:'portal',defer:delivery=>c.executionCtx.waitUntil(delivery)})
 return isPortalForm(c)?c.redirect(detailPath(identity.actor.projectId,result.ticket.id),303):c.json(result,result.duplicate?200:201)
})
portalApi.get('/:projectId/tickets/:ticketId',async c=>c.json(await portalRequestDetail(c.env,await access(c),c.req.param('ticketId'))))
portalApi.post('/:projectId/tickets/:ticketId/reply',async c=>{
 const identity=await access(c),body=await portalBody(c),isForm=isPortalForm(c),ticketId=c.req.param('ticketId')
 if(isForm){body.expectedRevision=Number(body.expectedRevision);const files=body.attachment;if(files instanceof File&&files.size){const uploaded=await attachPortalFile(c.env,identity,ticketId,{data:await files.arrayBuffer(),filename:files.name,contentType:files.type||'application/octet-stream'});body.mediaIds=[uploaded.id]}}
 const result=await replyPortalRequest(c.env,identity,ticketId,body,delivery=>c.executionCtx.waitUntil(delivery))
 c.executionCtx.waitUntil(publishResolution(c.env,identity.actor.projectId,ticketId))
 return isForm?c.redirect(detailPath(identity.actor.projectId,ticketId),303):c.json(result)
})
portalApi.post('/:projectId/tickets/:ticketId/reopen',async c=>{
 const identity=await access(c),body=await portalBody(c),result=await reopenPortalRequest(c.env,identity,c.req.param('ticketId'),isPortalForm(c)?Number(body.expectedRevision):body.expectedRevision)
 return isPortalForm(c)?c.redirect(detailPath(identity.actor.projectId,c.req.param('ticketId')),303):c.json(result)
})
portalApi.post('/:projectId/tickets/:ticketId/attachments',async c=>{
 const identity=await access(c),declared=Number(c.req.header('Content-Length'))
 if(declared>20000000)throw new HTTPException(413)
 const result=await attachPortalFile(c.env,identity,c.req.param('ticketId'),{data:await c.req.arrayBuffer(),filename:c.req.header('X-Filename')||'attachment',contentType:c.req.header('Content-Type')||'application/octet-stream'})
 return c.json(result,201)
})
portalApi.get('/:projectId/tickets/:ticketId/attachments/:mediaId',async c=>readPortalFile(c.env,await access(c),c.req.param('ticketId'),c.req.param('mediaId')))
portalApi.get('/:projectId/preferences',async c=>c.json(await readPortalPreferences(c.env,await access(c))))
portalApi.on(['POST','PUT'],'/:projectId/preferences',async c=>{
 const identity=await access(c),body=await portalBody(c)
 if(isPortalForm(c)){body.surveyEmails=body.surveyEmails==='true';body.updateEmails=body.updateEmails==='true'}
 const result=await savePortalPreferences(c.env,identity,body)
 return isPortalForm(c)?c.redirect(`/portal/${encodeURIComponent(identity.actor.projectId)}/preferences?saved=1`,303):c.json(result)
})
