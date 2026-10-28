import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {auditStatement,requestSource} from '../audit/record'
import {activeSurveySql,liveCycleSql,readSurveySettings,surveyJoins,type SurveySettings} from './survey-store'
import {surveySigningConfigured,surveyToken,verifySurveyToken} from './survey-links'
import {surveyForm,surveyThanks,surveyOptout,surveyUnavailable} from './survey-html'
import {publishResolution} from './state'
import {customerRecovery} from './recovery'
export const surveySettings=new Hono<AppEnv>()
surveySettings.get('/projects/:projectId/settings',async c=>{const actor=await scope(c);return c.json(await readSurveySettings(c.env,actor.projectId))})
surveySettings.put('/projects/:projectId/settings',async c=>{
 const actor=await scope(c,true),body=await c.req.json<SurveySettings>()
 if(body.widgetEnabled!==undefined&&typeof body.widgetEnabled!=='boolean')throw new HTTPException(400,{message:'Choose whether to show widget surveys'})
 if(body.widgetEnabled===undefined)body.widgetEnabled=(await readSurveySettings(c.env,actor.projectId)).widgetEnabled
 if(typeof body.enabled!=='boolean'||!['thumbs','five'].includes(body.scale)||!['en','es','fr'].includes(body.locale)||!Number.isInteger(body.delayMinutes)||body.delayMinutes<0||body.delayMinutes>43200||!Number.isInteger(body.expiresDays)||body.expiresDays<1||body.expiresDays>90)throw new HTTPException(400,{message:'Choose a scale, locale, delay (0–43,200 minutes), and link lifetime (1–90 days)'})
 if(body.enabled&&!surveySigningConfigured(c.env))throw new HTTPException(503,{message:'Set INBOUND_EMAIL_TOKEN to at least 16 characters before enabling email surveys'})
 const now=Date.now()
 await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO csat_settings(project_id,enabled,scale,delay_minutes,expires_days,locale,enabled_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,scale=excluded.scale,delay_minutes=excluded.delay_minutes,expires_days=excluded.expires_days,locale=excluded.locale,enabled_at=CASE WHEN csat_settings.enabled=0 AND excluded.enabled=1 THEN excluded.enabled_at ELSE csat_settings.enabled_at END,updated_at=excluded.updated_at`).bind(actor.projectId,body.enabled?1:0,body.scale,body.delayMinutes,body.expiresDays,body.locale,now,now),
  c.env.DB.prepare("INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES(?,json_object('csat_widget_enabled',json(?)),?) ON CONFLICT(project_id) DO UPDATE SET settings_json=json_set(settings_json,'$.csat_widget_enabled',json(?)),updated_at=excluded.updated_at").bind(actor.projectId,JSON.stringify(body.widgetEnabled),now,JSON.stringify(body.widgetEnabled)),
  ...(!body.enabled?[c.env.DB.prepare("UPDATE csat_surveys SET state='cancelled',revoked_at=?,updated_at=? WHERE project_id=? AND state='pending'").bind(now,now,actor.projectId)]:[]),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'csat.settings.updated',actor:{type:'user',id:actor.id},source:requestSource(c),detail:{enabled:body.enabled,widgetEnabled:body.widgetEnabled,scale:body.scale,delayMinutes:body.delayMinutes,expiresDays:body.expiresDays,locale:body.locale}})
 ])
 return c.json(await readSurveySettings(c.env,actor.projectId))
})
surveySettings.post('/projects/:projectId/surveys/:surveyId/revoke',async c=>{
 const actor=await scope(c,true),row=await c.env.DB.prepare('SELECT id FROM csat_surveys WHERE id=? AND project_id=?').bind(c.req.param('surveyId'),actor.projectId).first()
 if(!row)throw new HTTPException(404)
 await c.env.DB.batch([
  c.env.DB.prepare("UPDATE csat_surveys SET revoked_at=?,updated_at=?,state=CASE WHEN state='pending' THEN 'cancelled' ELSE state END WHERE id=? AND project_id=?").bind(Date.now(),Date.now(),c.req.param('surveyId'),actor.projectId),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'access',action:'csat.link.revoked',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'survey',id:c.req.param('surveyId')}})
 ])
 return c.json({revoked:true})
})
export const publicSurveys=new Hono<AppEnv>()
publicSurveys.onError((error,c)=>{
 if(error instanceof HTTPException&&c.req.header('Accept')?.includes('text/html')&&[404,409,410].includes(error.status))return c.html(surveyUnavailable(),error.status)
 throw error
})
publicSurveys.use('*',async(c,next)=>{c.header('Cache-Control','private, no-store');c.header('Referrer-Policy','same-origin');c.header('X-Robots-Tag','noindex, nofollow');c.header('Content-Security-Policy',"default-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");if(c.req.method==='POST'&&c.req.header('Origin')&&c.req.header('Origin')!==new URL(c.req.url).origin)throw new HTTPException(403);await next()})
async function available(c:any,token:string,optout=false){
 const verified=await verifySurveyToken(c.env,token),{row,revision}=verified,now=Date.now()
 const live=await c.env.DB.prepare(`SELECT s.id ${surveyJoins} WHERE s.id=? AND ${optout?`${liveCycleSql} AND s.revoked_at IS NULL AND s.expires_at>?`:activeSurveySql}`).bind(row.id,now).first()
 if(!live||!optout&&row.token_revision!==revision)throw new HTTPException(410,{message:'This survey link expired, was used, or is no longer available.'})
 return verified
}
publicSurveys.get('/:token',async c=>{
 const {row}=await available(c,c.req.param('token')),response=await c.env.DB.prepare('SELECT score,reason,comment,recovery FROM csat_responses WHERE resolution_id=?').bind(row.resolution_id).first<any>()
 return c.html(surveyForm(row,c.req.param('token'),response))
})
publicSurveys.post('/:token',async c=>{
 const {row,revision,surface}=await available(c,c.req.param('token')),body=c.req.header('Content-Type')?.includes('application/json')?await c.req.json():await c.req.parseBody(),score=Number(body.score),comment=body.comment??'',reason=body.reason??''
 if(!(row.scale==='thumbs'?[-1,1]:[1,2,3,4,5]).includes(score)||typeof comment!=='string'||comment.length>1000||typeof reason!=='string'||!['','speed','clarity','outcome','other'].includes(reason))throw new HTTPException(400,{message:'Choose a rating, an optional reason and a comment of up to 1,000 characters'})
 const recovery=customerRecovery(body.recovery),now=Date.now(),receipt=crypto.randomUUID(),normalized=row.scale==='thumbs'?score:score>=4?1:-1
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO csat_response_history(id,resolution_id,project_id,contact_id,channel,scale,score,reason,comment,revision,created_at,response_surface,recovery)
   SELECT ?,r.id,r.project_id,r.contact_id,'email',s.scale,?,?,?,COALESCE((SELECT revision FROM conversation_ratings WHERE resolution_id=r.id),0)+1,?,?,? ${surveyJoins} WHERE s.id=? AND s.token_revision=? AND ${activeSurveySql}`).bind(receipt,score,reason,comment,now,surface,recovery,row.id,revision,now),
  c.env.DB.prepare('UPDATE csat_surveys SET token_revision=token_revision+1,updated_at=? WHERE id=? AND token_revision=? AND EXISTS(SELECT 1 FROM csat_response_history WHERE id=?)').bind(now,row.id,revision,receipt),
  c.env.DB.prepare(`INSERT INTO csat_responses(resolution_id,project_id,contact_id,channel,scale,score,reason,comment,revision,updated_at,response_surface,recovery) SELECT resolution_id,project_id,contact_id,channel,scale,score,reason,comment,revision,created_at,response_surface,recovery FROM csat_response_history WHERE id=? ON CONFLICT(resolution_id) DO UPDATE SET channel=excluded.channel,scale=excluded.scale,score=excluded.score,reason=excluded.reason,comment=excluded.comment,revision=excluded.revision,updated_at=excluded.updated_at,response_surface=excluded.response_surface,recovery=excluded.recovery`).bind(receipt),
  c.env.DB.prepare('INSERT INTO conversation_rating_history SELECT id,resolution_id,?,comment,created_at,revision FROM csat_response_history WHERE id=?').bind(normalized,receipt),
  c.env.DB.prepare('INSERT INTO conversation_ratings SELECT resolution_id,?,comment,created_at,revision FROM csat_response_history WHERE id=? ON CONFLICT(resolution_id) DO UPDATE SET value=excluded.value,comment=excluded.comment,updated_at=excluded.updated_at,revision=excluded.revision').bind(normalized,receipt)
 ])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'This survey was already submitted or is no longer available.'})
 await auditStatement(c.env.DB,{projectId:row.project_id,category:'data',action:'csat.response.recorded',actor:{type:'system'},source:'email',target:{type:'resolution',id:row.resolution_id},detail:{channel:'email',responseSurface:surface}}).run()
 c.executionCtx.waitUntil(publishResolution(c.env,row.project_id,row.conversation_id))
 return c.html(surveyThanks(row,await surveyToken(c.env,{...row,token_revision:revision+1},surface)))
})
publicSurveys.get('/:token/optout',async c=>{const {row}=await available(c,c.req.param('token'),true);return c.html(surveyOptout(row,c.req.param('token')))})
publicSurveys.post('/:token/optout',async c=>{
 const {row}=await available(c,c.req.param('token'),true),now=Date.now()
 await c.env.DB.batch([
  c.env.DB.prepare(`INSERT OR IGNORE INTO csat_optouts(project_id,contact_id,created_at) SELECT s.project_id,s.contact_id,? ${surveyJoins} WHERE s.id=? AND ${liveCycleSql} AND s.revoked_at IS NULL AND s.expires_at>?`).bind(now,row.id,now),
  c.env.DB.prepare("UPDATE csat_surveys SET revoked_at=?,updated_at=?,state=CASE WHEN state='pending' THEN 'cancelled' ELSE state END WHERE project_id=? AND contact_id=? AND EXISTS(SELECT 1 FROM csat_optouts WHERE project_id=? AND contact_id=?)").bind(now,now,row.project_id,row.contact_id,row.project_id,row.contact_id),
  auditStatement(c.env.DB,{projectId:row.project_id,category:'data',action:'csat.opted_out',actor:{type:'system'},source:'email',target:{type:'contact',id:row.contact_id}})
 ])
 return c.html(surveyOptout(row,c.req.param('token'),true))
})
