import {rerMail} from '../../integrations/rer-mail-contract'
import type {Env} from '../../../platform/env'
import {localMailOrigin} from '../../../edition/local-mail/configuration'
import {emailConfigured} from '../../integrations/email-provider'
import {emailAddress, mailbox} from '../../integrations/inbound-routing'
import type {Condition} from './condition'

/** Local installs have no mail domain; this reserved name keeps the address valid and clearly local. */
const LOCAL_DOMAIN = 'localhost.test'

/** The workspace name as a mailbox local part: ASCII letters, digits and single hyphens, at most 24 characters. */
export function mailboxSlug(name: string) {
 const slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 24).replace(/-+$/, '')
 return slug || 'support'
}

/** The website's host without a leading `www.`, or null when no mail could reach it (an IP address, a single label, localhost). */
export function siteDomain(website: string): string | null {
 let host: string
 try { host = new URL(website).hostname.toLowerCase().replace(/^www\./, '') } catch { return null }
 if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host) || /(^|\.)localhost$/.test(host)) return null
 return host
}

/**
 * The address the workspace should send from once its own domain is verified: `support@<website domain>`. It is
 * recorded as `proposed_sender` in the project settings (json_insert, like the other I2 keys) whenever the website
 * has a domain that could receive mail, on local and hosted installs alike, with or without a mailbox. Activation
 * checks that domain's DNS and switches the sender over once it is confirmed.
 */
export function proposedSender(env: Env, seed: {projectId: string; website: string}, now: number, when: Condition): D1PreparedStatement[] {
 if(rerMail(env))return []
 const site = siteDomain(seed.website)
 if (!site) return []
 const address = `support@${site}`
 return [env.DB.prepare(`INSERT INTO project_settings(project_id,settings_json,updated_at) SELECT ?,json_object('proposed_sender',?),? WHERE ${when.sql}
   ON CONFLICT(project_id) DO UPDATE SET settings_json=json_insert(project_settings.settings_json,'$.proposed_sender',?),updated_at=excluded.updated_at`)
  .bind(seed.projectId, address, now, ...when.params, address)]
}

/**
 * The reply-by-email mailbox (RISKS.md R6), seeded only when the installation holds `INBOUND_EMAIL_TOKEN`:
 * `<slug>@<INBOUND_EMAIL_DOMAIN>`, else `<slug>@in.<website domain>`, else `<slug>@localhost.test` on a local install.
 * The first free address of `<slug>`, `<slug>-<8 project id characters>` and `<slug>-<project id>` is taken, so a
 * same-name workspace gets its own mailbox inside the creation batch instead of a conflict. Retired addresses of
 * deleted workspaces are never reused. The mailbox is enabled only when this installation can send mail, because the
 * same switch turns on reply notifications.
 *
 * Every mail tied to the workspace (sign-in links, invitations, notifications) goes out from this row's sender, so
 * it starts as the installation sender (`EMAIL_FROM`), which the provider already accepts; the workspace's own
 * address waits in `proposed_sender` until its domain is verified. Without `EMAIL_FROM` the installation cannot send
 * at all (the mailbox stays disabled), and the row holds `support@<website domain>` on a hosted install, or
 * `support@<mailbox domain>` locally or when the website has no mail domain, ready for when sending is configured.
 */
export function inboundMailbox(env: Env, seed: {projectId: string; name: string; website: string}, now: number, when: Condition): D1PreparedStatement[] {
 if (typeof env.INBOUND_EMAIL_TOKEN !== 'string' || !env.INBOUND_EMAIL_TOKEN.trim()) return []
 const local = Boolean(localMailOrigin(env)), site = siteDomain(seed.website)
 const override = typeof env.INBOUND_EMAIL_DOMAIN === 'string' ? env.INBOUND_EMAIL_DOMAIN.trim().toLowerCase() : ''
 const domain = override || (local || !site ? LOCAL_DOMAIN : `in.${site}`), slug = mailboxSlug(seed.name)
 const candidates = [slug, `${slug}-${seed.projectId.slice(0, 8)}`, `${slug}-${seed.projectId}`].map(part => mailbox(`${part}@${domain}`))
 if (candidates.some(address => !address)) {
  console.error('Inbound mailbox not seeded: INBOUND_EMAIL_DOMAIN is not a mail domain', seed.projectId)
  return []
 }
 const configuredSender = emailAddress(env.EMAIL_FROM)
 const sender = configuredSender ?? (!local && site ? `support@${site}` : `support@${domain}`)
 return [env.DB.prepare(`INSERT INTO email_settings(project_id,from_name,from_address,inbound_address,is_enabled,updated_at)
   SELECT ?,?,?,(
    SELECT address FROM (SELECT ? address,1 rank UNION ALL SELECT ?,2 UNION ALL SELECT ?,3) candidate
    WHERE NOT EXISTS(SELECT 1 FROM email_settings e WHERE lower(e.inbound_address)=candidate.address)
      AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE lower(json_extract(s.settings_json,'$.retired_inbound_address'))=candidate.address)
    ORDER BY rank LIMIT 1
   ),?,? WHERE ${when.sql}`)
  .bind(seed.projectId, seed.name.slice(0, 200), sender, ...candidates, emailConfigured(env) ? 1 : 0, now, ...when.params)]
}
