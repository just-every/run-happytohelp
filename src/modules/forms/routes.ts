import {Hono} from 'hono'
import {bodyLimit} from 'hono/body-limit'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {listForms,readForm} from './store'
import {submitRequest} from './submit'
import {resolvePortalActor} from '../portal/identity'
import {readPortalPreferences} from '../portal/preferences'
export const publicForms=new Hono<AppEnv>()
publicForms.use('*',bodyLimit({maxSize:2000000,onError:c=>c.json({error:'Request exceeds the form size limit'},413)}))
publicForms.use('*',async(c,next)=>{c.header('Cache-Control','no-store');await next()})
async function requestedLocale(c:any){
 if(c.req.query('locale'))return c.req.query('locale')
 const identity=await resolvePortalActor(c.env,c.req.param('projectId'),c.req.raw)
 return identity?(await readPortalPreferences(c.env,identity)).locale:undefined
}
publicForms.get('/:projectId',async c=>c.json({data:await listForms(c.env,c.req.param('projectId'),await requestedLocale(c))}))
publicForms.get('/:projectId/:formId',async c=>c.json({data:await readForm(c.env,c.req.param('projectId'),c.req.param('formId'),await requestedLocale(c))}))
publicForms.post('/:projectId/:formId/submissions',async c=>{
 const origin=c.req.header('Origin');if(origin&&origin!==new URL(c.req.url).origin)throw new HTTPException(403,{message:'Cross-origin request denied'})
 const result=await submitRequest(c.env,{projectId:c.req.param('projectId'),formId:c.req.param('formId'),body:await c.req.json(),request:c.req.raw,channel:'form',defer:delivery=>c.executionCtx.waitUntil(delivery)})
 return c.json(result,result.duplicate?200:201)
})
