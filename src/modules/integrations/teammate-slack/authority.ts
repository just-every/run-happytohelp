import type {Env} from '../../../platform/env'
import {memberAccess} from '../../access/gate'

/** RL-7: the member who installed the Slack destination must still be an owner or
 * admin with the integration-install permission before any provider work. */
export async function installerAuthorized(env:Env,projectId:string,destinationId:string){
 const installer=await env.DB.prepare("SELECT actor_id FROM native_integration_audit WHERE project_id=? AND resource_id=? AND action='destination.created'").bind(projectId,destinationId).first<{actor_id:string}>()
 const access=installer?.actor_id?await memberAccess(env.DB,projectId,installer.actor_id):null
 return !!access?.permissions.has('integrations.install')&&['owner','admin'].includes(access.base)
}
