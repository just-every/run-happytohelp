import { HTTPException } from 'hono/http-exception'
import { validWidgetOrigin } from '../activation/local-probes'
import { text } from '../common'
import {contactWritable} from '../../../platform/contact-state'
import {contactEnvironment} from '../../identity/contact-environment'
import type { WidgetCommand } from './types'

export async function updateContact({ c, actor, conversation, data }: WidgetCommand) {
  const fields: string[] = [], values: (string | null)[] = [], metadata: (string | null)[] = []
  for (const field of ['name', 'email'] as const) {
    const supplied = data[`provided_${field}`] ?? data[field]
    if (supplied === undefined) continue
    const value = supplied === null ? null : text(supplied, field === 'name' ? 200 : 320)
    if (field === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new HTTPException(400)
    // Both collector spellings are self-provided. Preserve them for operators
    // and erasure, without promoting them into an existing verified identity.
    metadata.push(`$.provided_${field}`, value)
    if (supplied !== null) {
      fields.push(`${field}=CASE WHEN is_verified=1 THEN ${field} ELSE ? END`)
      values.push(value || null)
    }
  }
  if (metadata.length) {
    // A typed address is a notification preference, never inbound mail authority
    // (integrations/inbound-authority.ts).
    const typedEmail = metadata.includes('$.provided_email') ? `,'$.email_unproven',1,'$.provided_email_source','widget'` : ''
    fields.push(`metadata_json=json_set(metadata_json,${metadata.map(() => '?').join(',')}${typedEmail})`)
    values.push(...metadata)
  }
  // Read back the actual canonical values in the same guarded write. Verification
  // can change after admission, and revocation/erasure must fence this write too.
  const result = await c.env.DB.prepare(`UPDATE contacts SET ${fields.join(',') || 'name=name'}
    WHERE id=? AND project_id=? AND ${contactWritable}
    AND coalesce(json_extract(metadata_json,'$.is_blocked'),0)!=1
    AND coalesce(json_extract(metadata_json,'$.is_deleted'),0)!=1
    AND EXISTS(SELECT 1 FROM sessions s JOIN projects p ON p.id=s.project_id
      WHERE s.token_hash=? AND s.role='contact' AND s.actor_id=?
      AND s.actor_id=contacts.id AND s.contact_id=contacts.id AND s.project_id=contacts.project_id
      AND s.revoked_at IS NULL
      AND s.expires_at>max(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
      AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=p.id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL))
    AND EXISTS(SELECT 1 FROM conversations cv WHERE cv.id=? AND cv.contact_id=contacts.id AND cv.project_id=contacts.project_id)
    RETURNING id,name,email,is_verified`)
    .bind(...values, actor.contactId!, actor.projectId, c.get('sessionHash'), actor.id, Date.now(), conversation.id)
    .run<{ id: string; name: string | null; email: string | null; is_verified: number }>()
  const contact = result.results[0]
  if (!contact) throw new HTTPException(409)
  return c.json({ updated: true, contact: { id: contact.id, name: contact.name, email: contact.email, verified: contact.is_verified === 1 } })
}

export async function recordPresence({ c, actor, conversation, data, action }: WidgetCommand) {
  const metadata: Record<string, unknown> = contactEnvironment(c.req.raw, data)
  if (action === 'instruction') metadata.widget_opened = Boolean(data.opened ?? data.value ?? true)
  const result=await c.env.DB.prepare(`UPDATE contacts SET metadata_json=json_patch(metadata_json,?) WHERE id=? AND project_id=? AND ${contactWritable}
    AND coalesce(json_extract(metadata_json,'$.is_blocked'),0)!=1
    AND coalesce(json_extract(metadata_json,'$.is_deleted'),0)!=1
    AND EXISTS(SELECT 1 FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.token_hash=? AND s.role='contact'
      AND s.actor_id=contacts.id AND s.contact_id=contacts.id AND s.project_id=contacts.project_id
      AND s.revoked_at IS NULL AND s.expires_at>max(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
      AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=p.id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL))
    AND EXISTS(SELECT 1 FROM conversations cv WHERE cv.id=? AND cv.contact_id=contacts.id AND cv.project_id=contacts.project_id)`)
    .bind(JSON.stringify(metadata), actor.contactId!, actor.projectId, c.get('sessionHash'), Date.now(), conversation.id).run()
  if(!result.meta.changes)throw new HTTPException(409)
  // Only accepted authenticated ping commands on the configured website count. Preview,
  // instruction/open events and arbitrary last_seen_at values cannot create a receipt.
  const origin = c.req.header('Origin')
  if ((action === 'pingActive' || action === 'pingAction') && validWidgetOrigin(origin, c.env.PREVIEW_ORIGIN)) {
    await c.env.DB.prepare(`INSERT INTO activation_widget_pings(project_id,origin,checked_at,receipt_ref)
      SELECT id,allowed_origin,?,? FROM projects WHERE id=? AND allowed_origin=?
      ON CONFLICT(project_id) DO UPDATE SET origin=excluded.origin,checked_at=excluded.checked_at,receipt_ref=excluded.receipt_ref`)
      .bind(Date.now(), crypto.randomUUID(), actor.projectId, origin).run()
  }
  return c.json({ recorded: true })
}
