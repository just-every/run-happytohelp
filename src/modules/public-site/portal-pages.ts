import {Hono} from 'hono'
import {portalStyles,portalCSP,withPortalStyles} from './portal-styles'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {shell} from './shell'
import {resolvePublicProject} from './help-center'
import {resolvePortalActor} from '../portal/identity'
import {listPortalRequests,portalRequestDetail} from '../portal/requests'
import {readPortalPreferences} from '../portal/preferences'
import {portalBase,portalTools,portalSignIn,portalList,portalDetail,portalPreferences} from './portal-content'
import {escapeHtml as e} from './html'

export const portalPages=new Hono<AppEnv>()
portalPages.use('/portal/*',async(c,next)=>{
 c.header('Content-Security-Policy',portalCSP);c.header('X-Content-Type-Options','nosniff');c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');c.header('Referrer-Policy','no-referrer');c.header('X-Robots-Tag','noindex, nofollow')
 await next()
})
portalPages.get('/portal/assets/portal.css',c=>{c.header('Content-Type','text/css; charset=utf-8');return c.body(portalStyles)})
async function render(c:any,view:'home'|'requests'|'detail'|'preferences'){
 const key=c.req.param('project'),project=await resolvePublicProject(c.env,key)
 if(!project)return c.html(shell({name:'Support'},'', '<h1>Support portal unavailable</h1>',{search:false,noindex:true}),404)
 const base=portalBase(key),identity=await resolvePortalActor(c.env,project.id,c.req.raw),tools=portalTools(key,project.id,Boolean(identity))
 let content:string
 if(!identity)content=portalSignIn(project.id,c.req.query('returnTo')||(view==='home'?`/portal/${encodeURIComponent(project.id)}/requests`:c.req.path),c.req.query('sent')==='1')
 else if(view==='detail'){
  try{content=portalDetail(project.id,await portalRequestDetail(c.env,identity,c.req.param('ticketId')))}catch(error){if(!(error instanceof HTTPException)||error.status!==404)throw error;return c.html(shell(project,`/help/${encodeURIComponent(key)}`,`<h1>Request not found</h1><p><a href="${e(base)}/requests">View your requests</a></p>`,{tools,search:false,noindex:true}),404)}
 }else if(view==='preferences')content=portalPreferences(project.id,await readPortalPreferences(c.env,identity),c.req.query('saved')==='1')
 else content=portalList(key,await listPortalRequests(c.env,identity,Number(c.req.query('before'))))
 return c.html(withPortalStyles(shell(project,`/help/${encodeURIComponent(key)}`,content,{tools,search:false,noindex:true,title:`${project.name} support requests`})))
}
portalPages.get('/portal/:project',c=>render(c,'home'))
portalPages.get('/portal/:project/requests',c=>render(c,'requests'))
portalPages.get('/portal/:project/preferences',c=>render(c,'preferences'))
// The static /requests/new route is registered by the form service before this router.
portalPages.get('/portal/:project/requests/:ticketId',c=>render(c,'detail'))
