import {rerMailboxSeed} from './rer-mailbox'
import {rerMail} from '../../integrations/rer-mail-contract'
import {processRerMailbox} from '../../integrations/rer-mailbox'
import type {Env} from '../../../platform/env'
import type {SqlGuard} from '../../../platform/integration-authority'
import {enqueueSiteRead} from '../site-read/index'
import {creationCondition} from './condition'
import {inboundMailbox, proposedSender} from './inbound-mailbox'
import {starterAssistant} from './starter-assistant'
import {ownerAlerts} from './owner-alerts'

export {starterModels, defaultStarterProvider, installedProvider, providerKeyInstalled, starterModel, modelReady, modelReadiness} from './models'
export type {ModelProvider} from './models'
export {starterSeed} from './starter-assistant'

export type WorkspaceSeed = {projectId: string; name: string; website: string; ownerEmail: string}

/**
 * What every new workspace starts with (BUILD.md I1): the starter assistant as its default responder, the `starter_ai`
 * marker, the `proposed_sender` its mail moves to once its domain is verified, when the installation holds
 * `INBOUND_EMAIL_TOKEN`, its reply-by-email mailbox, sending from the installation sender until then, and new-conversation
 * alerts for its owner.
 *
 * `statements` join the creation batch after the project, owner membership and any project settings inserts, so they commit
 * with the workspace or not at all; `guard` (the caller's creation guard, `EXISTS(guard.sql)`) is asserted on each.
 * `after` runs once the batch has committed: it queues the one-time read of the website and never throws.
 * Demo workspaces are not created through here and are never provisioned.
 */
export function workspaceDefaults(env: Env, seed: WorkspaceSeed, guard?: SqlGuard): {statements: D1PreparedStatement[]; after: () => Promise<void>} {
 const now = Date.now(), when = creationCondition(seed.projectId, guard)
 return {
  statements: [...starterAssistant(env, seed.projectId, now, when), ...proposedSender(env, seed, now, when), ...(rerMail(env)?rerMailboxSeed(env,seed,now,when):inboundMailbox(env, seed, now, when)), ...ownerAlerts(env, seed.projectId, when)],
  after: async () => {
   if(rerMail(env))try{await processRerMailbox(env,seed.projectId)}catch{console.error('Managed mailbox binding remains queued')}
   try { await enqueueSiteRead(env, seed.projectId) } catch (error) {
    console.error('Site read not queued', seed.projectId, error instanceof Error ? error.message : String(error))
   }
  },
 }
}
