import {eraseDoorContact} from '../move-in/door/erasure'
import {redactionStatements,invalidateTransfersStatements} from '@runeditrun/rer/modules/portability/journal'
import {csvErasureIdentities} from '../import-kit/csv/erasure'
import {Hono,type Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../platform/env'
import {scope} from './common'
import {hashToken} from '../../platform/auth'
import {erasureEnvironment} from './contact-erasure/authority'
import {deleteStagedObjects,fenceAndStage,stageLegacyObjects} from './contact-erasure/objects'
import {redactLegacyArchive} from './contact-erasure/archive'
import {legacyPerson} from './contact-erasure/archive-person'
import {erasureStatements} from './contact-erasure/statements'
import {contactEmails} from './contact-erasure/identity'
import {generations,localJobs} from './contact-erasure/scope'
import {providerErasureStatements,providerRequests} from './contact-erasure/providers'
import {auditStatement,requestSource} from '../audit/record'
import {requireStepUp} from '../identity/two-factor/step-up'
import {knowledgeErasureStatements} from '../knowledge/feedback'
import {ERASURE_COMPLETED,ERASURE_LEASE_MS,ErasureInProgress,ErasureLeaseLost,leaseCompletion,takeErasureLease,type ErasureLease} from './contact-erasure/lease'

export interface ContactErasure {project_id: string; contact_id: string; erased_by: string; erased_at: number; last_erased_at: number; runs: number; conversations: number; messages: number; attachments: number; tracked_events: number; context_records: number; sessions: number; ticket_records:number}

/**
 * Permanently erase one contact's personal data inside its project. Steps are ordered
 * so an interrupted request is completed by repeating it: fence and stage objects (the
 * legacy files found through the legacy journal too), delete R2 objects, clear the
 * legacy journal's copies in bounded calls, then commit every other D1 change and the
 * audit row atomically. Runs under the contact's erasure lease (contact-erasure/lease.ts),
 * renewed between stages and journal slices; the route deletes it with the provider requests and audit row.
 */
export async function eraseContact(env: Env, projectId: string, contactId: string, actorId: string, lease: ErasureLease, sessionHash?:string) {
  if(sessionHash)env=erasureEnvironment(env,projectId,actorId,sessionHash)
  const contact = await env.DB.prepare('SELECT email,external_id,metadata_json FROM contacts WHERE project_id=? AND id=?').bind(projectId, contactId).first<{email: string | null; external_id:string|null; metadata_json: string | null}>()
  if (!contact) return null
  const csvBeforeFence=await csvErasureIdentities(env,projectId,contactId,contactEmails(contact))
  const now = Date.now()
  const fenced=await fenceAndStage(env, projectId, contactId, now, contact)
  const legacy=await legacyPerson(env, projectId, contactId, lease)
  await lease.renew()
  await stageLegacyObjects(env, projectId, contactId, legacy.own_files)
  await deleteStagedObjects(env, projectId, contactId)
  await redactLegacyArchive(env, projectId, contactId, legacy, lease)
  await lease.renew()
  const emails=[...new Set([...contactEmails(contact),...contactEmails(fenced??{})])]
  const csvIdentities=[...new Set([...csvBeforeFence,...await csvErasureIdentities(env,projectId,contactId,emails)])]
  await eraseDoorContact(env,projectId,contactId,actorId,emails,sessionHash,async scoped=>({
    checkpoint:await redactionStatements(scoped.DB),
    native:[...await invalidateTransfersStatements(scoped.DB),...await knowledgeErasureStatements(scoped,projectId,contactId,emails),...await erasureStatements(scoped,{projectId,contactId,actorId,now,emails,csvIdentities})],
  }))
  return env.DB.prepare('SELECT * FROM contact_erasures WHERE project_id=? AND contact_id=?').bind(projectId, contactId).first<ContactErasure>()
}

export const contactErasure = new Hono<AppEnv>()
/** A request that finds the contact being erased (or a legacy delta applying to the workspace) answers 409 with Retry-After. */
const busy = (c: Context<AppEnv>, message: string, seconds: number) => c.json({error: message}, 409, {'Retry-After': String(seconds)})

/** The erasure record as both routes answer it: the record (read here unless given), its API inventory and provider requests. */
async function erasureRecord(env: Env, projectId: string, contactId: string, erasure?: ContactErasure | null) {
  erasure ??= await env.DB.prepare('SELECT * FROM contact_erasures WHERE project_id=? AND contact_id=?').bind(projectId, contactId).first<ContactErasure>()
  if (!erasure) throw new HTTPException(404)
  return {data: {...erasure, api: await env.DB.prepare('SELECT requests,appends,notes,pending_payloads,held_requests FROM api_erasure_inventory WHERE project_id=? AND contact_id=?').bind(projectId, contactId).first(), providers: await providerRequests(env, projectId, contactId)}}
}

/**
 * One erasure of a contact at a time: after scope, existence and step-up, the request takes the contact's lease (waiting up
 * to 30 s for one in progress, then 409 with Retry-After), and only then reads or writes the person's data. A request that
 * waited for another erasure of the contact and finds it complete answers its record and does none of the erasure's work.
 * Any other repeat (sent on its own, or sent again after a 409) takes a fresh lease and completes as a repeat, erasing what
 * arrived since; an interrupted erasure's lease is taken over once it expires. The lease goes in the batch that records the
 * provider requests and audit row, so a failure before that leaves it for the next request to take over and complete.
 */
contactErasure.post('/projects/:projectId/contacts/:contactId/erase', async c => {
  const actor = await scope(c, true), contactId = c.req.param('contactId')
  const token=c.req.header('Authorization')?.replace(/^Bearer /,'')||c.req.header('Cookie')?.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1]
  if (!await c.env.DB.prepare('SELECT 1 FROM contacts WHERE project_id=? AND id=?').bind(actor.projectId, contactId).first()) throw new HTTPException(404)
  await requireStepUp(c, actor, 'contact.erase')
  let lease: ErasureLease
  try {
    const taken = await takeErasureLease(c.env.DB, actor.projectId, contactId)
    if (taken === ERASURE_COMPLETED) return c.json(await erasureRecord(c.env, actor.projectId, contactId))
    lease = taken
  } catch (error) {if (error instanceof ErasureInProgress) return busy(c, error.message, error.retryAfter); throw error}
  let erasure: ContactErasure | null, completed = false
  try {
    // What reached providers is read before local erasure removes the evidence of it.
    const reach = await c.env.DB.prepare(`SELECT external_id,(EXISTS(${generations}) OR EXISTS(SELECT 1 FROM triage_jobs WHERE project_id=?1 AND conversation_id IN (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2) AND provider_started=1)) ai,EXISTS(${localJobs}) computers FROM contacts WHERE project_id=?1 AND id=?2`).bind(actor.projectId, contactId).first<{external_id:string|null;ai:number;computers:number}>()
    if (!reach) throw new HTTPException(404)
    erasure = await eraseContact(c.env, actor.projectId, contactId, actor.id, lease, await hashToken(token!))
    if (!erasure) throw new HTTPException(404)
    const now = Date.now()
    await c.env.DB.batch([
      ...providerErasureStatements(c.env, {projectId: actor.projectId, contactId, externalId: reach.external_id ?? null, now, usedAi: Boolean(reach.ai), usedComputers: Boolean(reach.computers)}),
      auditStatement(c.env.DB, {projectId: actor.projectId, category: 'erasure', action: 'contact.erased', actor: {type: 'user', id: actor.id}, source: requestSource(c), target: {type: 'contact', id: contactId}, detail: {run: erasure.runs, conversations: erasure.conversations, messages: erasure.messages, attachments: erasure.attachments, trackedEvents: erasure.tracked_events, contextRecords: erasure.context_records, sessions: erasure.sessions, ticketRecords:erasure.ticket_records}}, now),
      leaseCompletion(c.env.DB, actor.projectId, contactId),
    ])
    completed = true
  } catch (error) {
    if (error instanceof ErasureLeaseLost) return busy(c, 'This contact is already being erased. Try again in a minute to confirm it completed.', ERASURE_LEASE_MS / 1000)
    throw error
  } finally {
    // The completed request's batch deleted the lease; otherwise any request may take it over now. A failed release expires in a minute.
    if (!completed) await lease.release().catch(() => {})
  }
  return c.json(await erasureRecord(c.env, actor.projectId, contactId, erasure))
})
contactErasure.get('/projects/:projectId/contacts/:contactId/erasure', async c => {
  const actor = await scope(c, true)
  return c.json(await erasureRecord(c.env, actor.projectId, c.req.param('contactId')))
})
