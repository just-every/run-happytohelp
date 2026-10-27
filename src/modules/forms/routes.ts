import {withAccountChoices} from './account-lookup'
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
async function requestedContext(c:any){
 const identity=await resolvePortalActor(c.env,c.req.param('projectId'),c.req.raw)
 const locale=c.req.query('locale')||(identity?(await readPortalPreferences(c.env,identity)).locale:undefined)
 return {locale,identity}
}
publicForms.get('/:projectId',async c=>{
 const {locale,identity}=await requestedContext(c),forms=await listForms(c.env,c.req.param('projectId'),locale)
 return c.json({data:await Promise.all(forms.map(form=>withAccountChoices(c.env,form,identity)))})
})
publicForms.get('/:projectId/:formId',async c=>{
 const {locale,identity}=await requestedContext(c),form=await readForm(c.env,c.req.param('projectId'),c.req.param('formId'),locale)
 return c.json({data:await withAccountChoices(c.env,form,identity)})
})
publicForms.post('/:projectId/:formId/submissions',async c=>{
 const origin=c.req.header('Origin');if(origin&&origin!==new URL(c.req.url).origin)throw new HTTPException(403,{message:'Cross-origin request denied'})
 const result=await submitRequest(c.env,{projectId:c.req.param('projectId'),formId:c.req.param('formId'),body:await c.req.json(),request:c.req.raw,channel:'form',defer:delivery=>c.executionCtx.waitUntil(delivery)})
 return c.json(result,result.duplicate?200:201)
})
