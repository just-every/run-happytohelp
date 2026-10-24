import type {Env} from '../../platform/env'
import {rerMail} from './rer-mail-contract'
import {rerMailboxSeed} from '../management/provisioning/rer-mailbox'

/** Redeploying an existing installation with Managed capability must provision
 * the same durable binding as first run. Never resurrect archived/deleted rows. */
export async function seedMissingRerMailbox(env:Env,projectId:string){
 if(!rerMail(env))return
 const project=await env.DB.prepare(`SELECT id,name FROM projects WHERE id=?
  AND NOT EXISTS(SELECT 1 FROM rer_mailboxes WHERE project_id=projects.id)
  AND NOT EXISTS(SELECT 1 FROM project_settings WHERE project_id=projects.id AND json_extract(settings_json,'$.deleted_at') IS NOT NULL)`)
  .bind(projectId).first<{id:string;name:string}>()
 if(!project)return
 const when={sql:`EXISTS(SELECT 1 FROM projects WHERE id=?) AND NOT EXISTS(SELECT 1 FROM project_settings WHERE project_id=? AND json_extract(settings_json,'$.deleted_at') IS NOT NULL)`,params:[projectId,projectId]}
 await env.DB.batch(rerMailboxSeed(env,{projectId,name:project.name},Date.now(),when))
}
