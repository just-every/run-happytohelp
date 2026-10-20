import {csvErasureIdentities} from '../import-kit/csv/erasure'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../platform/env'
import {scope} from './common'
import {hashToken} from '../../platform/auth'
import {erasureEnvironment} from './contact-erasure/authority'
import {deleteStagedObjects,fenceAndStage} from './contact-erasure/objects'
import {erasureStatements} from './contact-erasure/statements'
import {contactEmails} from './contact-erasure/identity'
import {generations,localJobs} from './contact-erasure/scope'
import {providerErasureStatements,providerRequests} from './contact-erasure/providers'
import {auditStatement,requestSource} from '../audit/record'
import {requireStepUp} from '../identity/two-factor/step-up'
import {knowledgeErasureStatements} from '../knowledge/feedback'

export interface ContactErasure {project_id: string; contact_id: string; erased_by: string; erased_at: number; last_erased_at: number; runs: number; conversations: number; messages: number; attachments: number; tracked_events: number; context_records: number; sessions: number; ticket_records:number}

/**
 * Permanently erase one contact's personal data inside its project. Steps are ordered
 * so an interrupted request is completed by repeating it: fence and stage objects,
 * delete R2 objects, then commit every D1 change and the audit row atomically.
 */
export async function eraseContact(env: Env, projectId: string, contactId: string, actorId: string, sessionHash?:string) {
  if(sessionHash)env=erasureEnvironment(env,projectId,actorId,sessionHash)
  const contact = await env.DB.prepare('SELECT email,external_id,metadata_json FROM contacts WHERE project_id=? AND id=?').bind(projectId, contactId).first<{email: string | null; external_id:string|null; metadata_json: string | null}>()
  if (!contact) return null
  const csvBeforeFence=await csvErasureIdentities(env,projectId,contactId,contactEmails(contact))
  const now = Date.now()
  const fenced=await fenceAndStage(env, projectId, contactId, now, contact)
  await deleteStagedObjects(env, projectId, contactId)
  const emails=[...new Set([...contactEmails(contact),...contactEmails(fenced??{})])]
  const csvIdentities=[...new Set([...csvBeforeFence,...await csvErasureIdentities(env,projectId,contactId,emails)])]
  await env.DB.batch([
    ...await knowledgeErasureStatements(env,projectId,contactId,emails),
    ...erasureStatements(env, {projectId, contactId, actorId, now, emails,csvIdentities}),
  ])
  return env.DB.prepare('SELECT * FROM contact_erasures WHERE project_id=? AND contact_id=?').bind(projectId, contactId).first<ContactErasure>()
}

export const contactErasure = new Hono<AppEnv>()
contactErasure.post('/projects/:projectId/contacts/:contactId/erase', async c => {
  const actor = await scope(c, true), contactId = c.req.param('contactId')
  const token=c.req.header('Authorization')?.replace(/^Bearer /,'')||c.req.header('Cookie')?.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1]
  // What reached providers is read before local erasure removes the evidence of it.
  const reach = await c.env.DB.prepare(`SELECT external_id,EXISTS(${generations}) ai,EXISTS(${localJobs}) computers FROM contacts WHERE project_id=?1 AND id=?2`).bind(actor.projectId, contactId).first<{external_id:string|null;ai:number;computers:number}>()
  if (!reach) throw new HTTPException(404)
  await requireStepUp(c, actor, 'contact.erase')
  const erasure = await eraseContact(c.env, actor.projectId, contactId, actor.id,await hashToken(token!))
  if (!erasure) throw new HTTPException(404)
  const now = Date.now()
  await c.env.DB.batch([
    ...providerErasureStatements(c.env, {projectId: actor.projectId, contactId, externalId: reach?.external_id ?? null, now, usedAi: Boolean(reach?.ai), usedComputers: Boolean(reach?.computers)}),
    auditStatement(c.env.DB, {projectId: actor.projectId, category: 'erasure', action: 'contact.erased', actor: {type: 'user', id: actor.id}, source: requestSource(c), target: {type: 'contact', id: contactId}, detail: {run: erasure.runs, conversations: erasure.conversations, messages: erasure.messages, attachments: erasure.attachments, trackedEvents: erasure.tracked_events, contextRecords: erasure.context_records, sessions: erasure.sessions, ticketRecords:erasure.ticket_records}}, now),
  ])
  return c.json({data: {...erasure, providers: await providerRequests(c.env, actor.projectId, contactId)}})
})
contactErasure.get('/projects/:projectId/contacts/:contactId/erasure', async c => {
  const actor = await scope(c, true), contactId = c.req.param('contactId')
  const erasure = await c.env.DB.prepare('SELECT * FROM contact_erasures WHERE project_id=? AND contact_id=?').bind(actor.projectId, contactId).first<ContactErasure>()
  if (!erasure) throw new HTTPException(404)
  return c.json({data: {...erasure, providers: await providerRequests(c.env, actor.projectId, contactId)}})
})
