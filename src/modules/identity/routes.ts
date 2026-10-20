import { Hono } from 'hono'
import type { AppEnv } from '../../platform/env'
import { requireActor,requireProject } from '../../platform/auth'
import { endSession } from './signout'
import { accounts } from './accounts'
import { recovery } from './recovery'
import { widget } from './widget'
import { widgetProfile } from './widget-profile'
import { registration } from './registration'
import { setup } from './setup'
import { options } from './options'
import { linkStatus } from './link-status'
import { magicLink } from './magic-link'
import { twoFactor } from './two-factor/routes'
import { emailStepUp } from './two-factor/email-step-up'
import { ownerRecovery } from './two-factor/owner-recovery'
import { pendingFactor } from './two-factor/state'
export const routes=new Hono<AppEnv>()
routes.route('/',accounts)
routes.route('/',recovery)
routes.route('/',widget)
routes.route('/',widgetProfile)
routes.route('/',registration)
routes.route('/',setup)
routes.route('/',options)
routes.route('/',linkStatus)
routes.route('/',magicLink)
routes.route('/',twoFactor)
routes.route('/',emailStepUp)
routes.route('/',ownerRecovery)
routes.get('/session',async c=>{const {security,...actor}=await requireActor(c),twoFactor=security?pendingFactor(security):null;return c.json(twoFactor?{...actor,twoFactor}:actor)})
routes.delete('/session',async c=>{await endSession(c);return c.json({revoked:true})})
routes.get('/projects/:projectId',async c=>{await requireProject(c,c.req.param('projectId'),true);return c.json(await c.env.DB.prepare('SELECT id,name,widget_key,allowed_origin,created_at FROM projects WHERE id=?').bind(c.req.param('projectId')).first())})

routes.get('/editor-config',async c=>{
 const actor=await requireActor(c);
 if(!actor.projectId||!['owner','admin'].includes(actor.role))return c.json({error:'Project owner or admin required'},403);
 c.header('Cache-Control','no-store');
 const managementOrigin=typeof c.env.RER_MANAGEMENT_ORIGIN==='string'?c.env.RER_MANAGEMENT_ORIGIN:'';
 const installationId=typeof c.env.RER_INSTALLATION_ID==='string'?c.env.RER_INSTALLATION_ID:'';
 return c.json({enabled:Boolean(managementOrigin&&installationId),managementOrigin,installationId});
})
