import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {seedExtendedLegacy, PLANTED_SECRETS} from './extended-fixture.mjs';

const uuid = (group, number) => `${group}000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const LEGACY_IDS = Object.freeze({
  projectIds: [uuid('10', 1), uuid('10', 2)],
  ownerId: uuid('20', 1),
});
const timestamp = '2026-01-15 09:30:00';
const times = { created_at: timestamp, updated_at: timestamp };
const json = JSON.stringify;

/** Seed a fresh, local MySQL database and an on-disk S3 object directory. */
export async function seedLegacy(connection, { objectDirectory }) {
  if (!objectDirectory) throw new Error('objectDirectory is required for legacy attachment objects');
  // Aurora MySQL 8.0 permits foreign keys to indexed nonunique legacy IDs.
  const [fkMode]=await connection.query("SHOW VARIABLES LIKE 'restrict_fk_on_non_standard_key'");
  if(fkMode.length)await connection.query('SET SESSION restrict_fk_on_non_standard_key=OFF');
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  for (const statement of schema.replace(/^--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean)) {
    await connection.execute(statement);
  }
  const counts = {};
  const insert = async (table, row) => {
    const columns = Object.keys(row);
    await connection.execute(
      `INSERT INTO \`${table}\` (${columns.map(column => `\`${column}\``).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      Object.values(row),
    );
    counts[table] = (counts[table] ?? 0) + 1;
  };
  const user = (id, name, email, type = 'regular') => insert('users', {
    id, name, email, type, password: 'fixture-password-hash', remember_token: 'fixture-remember-token',
    timezone: 'Australia/Brisbane', last_login_ip: '192.0.2.10', last_login_country: 'AU', ...times,
  });
  const { projectIds, ownerId } = LEGACY_IDS;
  await user(ownerId, 'Export Owner', 'export-owner@example.test');
  await insert('ai_defaults', { id: uuid('21', 1), type: 'support', role: 'Customer support',
    prompt: 'Answer using the project knowledge base.', ...times });

  await insert('password_resets', {email:'export-owner@example.test',token:'fixture-password-reset-token',created_at:timestamp});

  for (const [index, name] of ['ChargeDesk', '12ui'].entries()) {
    const n = index + 1;
    const projectId = projectIds[index];
    const slug = index ? '12ui' : 'chargedesk';
    const aiId = uuid('22', n);
    const contactId = uuid('30', n);
    const participantId = uuid('31', n);
    const conversationId = uuid('40', n);
    const resolvedId = uuid('41', n);
    const bucketId = uuid('50', n);
    const articleId = uuid('70', n);
    const categoryId = uuid('71', n);
    const draftCategoryId = uuid('72', n);
    const mediaId = uuid('80', n);
    const directory = `${projectId}/${conversationId}`;
    const fileContent = Buffer.from(`${name} fixture invoice\nAmount: AUD ${n * 25}.00\n`.repeat(index?1:220000), 'utf8');
    const messageIds = Array.from({ length: 5 }, (_, i) => uuid('60', n * 10 + i));

    await insert('projects', {
      id: projectId, name, slug, website: `https://${slug}.example.test`, timezone: 'Australia/Brisbane',
      email_from_name: `${name} Support`, email_from_address: `support@${slug}.example.test`,
      help_center_domain: `help.${slug}.example.test`, verification_secret: `fixture-verification-${slug}`,
      is_proxy_only: 0, is_contact_tracking_enabled: 1, is_ai_balance_top_up_enabled: 0,
      proxy_html_requests_count: 3, proxy_other_requests_count: 8, ai_balance: '12.500000', ai_monthly_budget: '100.00',
      ai_balance_top_up_when_below: '5.00', ai_balance_top_up_amount: '20.00',
      availability_schedule: json({ monday: [{ start: '09:00', end: '17:00' }] }),
      widget_settings: json({ theme: { chat: { user: { background: index ? '#5046e5' : '#168c76' } } },
        settings: { collect: { require_email: true } }, text: { message: { placeholder_message: `Ask ${name}` } } }),
      widget_settings_hash: `fixture-${slug}`, metadata: json({ source: 'legacy-export-fixture', brand: name }), ...times,
    });
    await insert('project_users', { id: uuid('23', n), project_id: projectId, user_id: ownerId,
      role: 'OWNER', is_primary: index === 0 ? 1 : 0, accepted_at: timestamp, ...times });
    await insert('project_users', { id: uuid('24', n), project_id: projectId, user_id: null, invited_by_id: ownerId,
      role: 'AGENT', invitation_email: `invited@${slug}.example.test`, invitation_token: `fixture-invitation-${slug}`, ...times });
    await user(aiId, `${name} Assistant`, `ai@${slug}.example.test`, 'ai');
    await insert('ais', { id: aiId, project_id: projectId, type: 'support', name: `${name} Assistant`,
      role: '', prompt: '', avatar_url: `https://${slug}.example.test/assistant.png`, ...times });
    await connection.execute('UPDATE projects SET default_visitor_ai_id = ?, default_verified_user_ai_id = ? WHERE id = ?',
      [aiId, aiId, projectId]);
    for (const [id, displayName, email] of [[contactId, 'Morgan Customer', `customer@${slug}.example.test`],
      [participantId, 'Taylor Accounts', `accounts@${slug}.example.test`]]) {
      await insert('contacts', { id, project_id: projectId, name: displayName, email,
        provided_name: id === contactId ? `Morgan at ${name}` : null,
        provided_email: id === contactId ? `preferred@${slug}.example.test` : null,
        nickname: 'Blue Finch', identifier: `${slug}-${id === contactId ? 'customer' : 'accounts'}`,
        timezone: 'Australia/Brisbane', country_code: 'AU', language: 'en',
        is_verified: 1, ai_profile:json({summary:'api_token=fixture-profile-known-credential'}), key_hashes: json(['fixture-contact-key-hash']), metadata: json({ plan: 'business', company: name,admin:'fixture-contact-admin-capability' }), ...times });
    }
    await insert('conversations', { id: conversationId, project_id: projectId, contact_id: contactId,
      agent_id: ownerId, metadata: json({ subject: `${name}: invoice question`,customer_reply:{api_key:'synthetic-fixture-reply-cache-credential'},suggestions:{tool_response:'fixture-suggestion-cache-credential'} }), unread_contact_messages_count: 1, ...times });
    await insert('conversations', { id: resolvedId, project_id: projectId, contact_id: participantId,
      agent_id: aiId, ai_id: aiId, resolved_at: timestamp, metadata: json({ subject: `${name}: resolved setup` }), ...times });
    await insert('conversation_participants', { id: uuid('42', n), conversation_id: conversationId, contact_id: participantId, ...times });
    await insert('buckets', { id: bucketId, project_id: projectId, conversation_id: conversationId,
      is_vectorized:0, counts: json({ contact_messages: 1, agent_messages: 2, agent_events_internal_note: 1, contact_events_page_view: 1 }), ...times });

    // The reply links the customer's attachment by its legacy storage URL, and an older file the export does not carry.
    const bodies = [`Diagnostic: GPTCODEX_API_KEY=fixture-transcript-environment-value\nCan you explain this ${name} invoice?`, `The invoice covers your current billing period. Reset password: https://${slug}.example.test/password/reset (never share fixture-transcript-environment-value). Your copy: https://storage.happytohelp.com/${directory}/invoice.txt (last year's: https://storage.happytohelp.com/${directory}/invoice-2025.txt)`,
      'I can help you find the billing guide.', 'Our team will reply during business hours.', 'Removed duplicate message.'];
    for (let i = 0; i < bodies.length; i++) {
      await insert('messages', { id: messageIds[i], project_id: projectId, conversation_id: conversationId, bucket_id: bucketId,
        contact_id: i === 0 ? contactId : null, agent_id: i === 1 || i === 4 ? ownerId : i === 2 ? aiId : null,
        local_id: `${slug}-local-${i}`, content: bodies[i], content_raw: i === 0 ? `From: customer@${slug}.example.test\n\n${bodies[i]}` : null,
        read_by_agents: i === 0 ? json({ [ownerId]: timestamp }) : null,
        read_by_contacts: i === 1 ? json({ [contactId]: timestamp }) : null,
        notified_by: i === 1 ? json({ [contactId]: timestamp }) : null, notified_at: i === 1 ? timestamp : null,
        ...times, created_at: `2026-01-15 09:30:0${i}.123`, deleted_at: i === 4 ? '2026-01-15 10:00:00' : null });
    }
    await connection.execute('UPDATE conversations SET last_message_id = ?, last_message_at = ? WHERE id = ?',
      [messageIds[3], '2026-01-15 09:30:03', conversationId]);
    await connection.execute('UPDATE buckets SET first_message_id = ?, last_message_id = ? WHERE id = ?',
      [messageIds[0], messageIds[3], bucketId]);
    await insert('events', { id: uuid('51', n), conversation_id: conversationId, bucket_id: bucketId, agent_id: ownerId,
      type: 'INTERNAL_NOTE', payload: json(`Check ${name} billing before issuing a credit. Internal only.`), created_at: timestamp });
    await insert('events', { id: uuid('52', n), conversation_id: conversationId, bucket_id: bucketId, contact_id: contactId,
      type: 'PAGE_VIEW', payload: json({ url: `https://${slug}.example.test/billing`, title: 'Billing' }), created_at: timestamp });

    await mkdir(join(objectDirectory, directory), { recursive: true });
    await writeFile(join(objectDirectory, directory, 'invoice.txt'), fileContent);
    await insert('media', { id: mediaId, disk: 's3', directory, filename: 'invoice', extension: 'txt',
      filename_original: `${slug}-invoice.txt`, mime_type: 'text/plain', aggregate_type: 'document', size: fileContent.length,
      url: `https://storage.example.test/${directory}/invoice.txt`, ...times });
    await insert('mediables', { media_id: mediaId, mediable_type: 'App\\Models\\Message', mediable_id: messageIds[0], tag: 'attachment', order: 0 });
    for (const [id, title, published, left, right, parent] of [[categoryId, 'Getting started', timestamp, 1, 4, null],
      [draftCategoryId, 'Unpublished billing tips', null, 2, 3, categoryId]]) {
      await insert('categories', { id, project_id: projectId, title, slug: title.toLowerCase().replaceAll(' ', '-'),
        summary: `${name} ${title.toLowerCase()}`, _lft: left, _rgt: right, parent_id: parent,
        created_by_id: ownerId, modified_by_id: ownerId, published_at: published, ...times });
    }
    await insert('articles', { id: articleId, project_id: projectId, title: `${name} billing guide`, slug: `${slug}-billing-guide`,
      summary: 'Understand your first invoice.', content: '<h1>Billing guide</h1><p>Invoices cover the current billing period.</p>',
      created_by_id: ownerId, modified_by_id: ownerId, published_at: timestamp, ...times });
    if (!index) {
      // The first company's guide shows a diagram from legacy storage, joined to the article as legacy joins it.
      const diagram = Buffer.from('fixture article diagram bytes');
      await mkdir(join(objectDirectory, projectId, 'articles'), { recursive: true });
      await writeFile(join(objectDirectory, projectId, 'articles', 'diagram.txt'), diagram);
      await insert('media', { id: uuid('c4', n), disk: 's3', directory: `${projectId}/articles`, filename: 'diagram', extension: 'txt',
        filename_original: 'diagram.txt', mime_type: 'text/plain', aggregate_type: 'document', size: diagram.length,
        url: `https://storage.happytohelp.com/${projectId}/articles/diagram.txt`, ...times });
      await insert('mediables', { media_id: uuid('c4', n), mediable_type: 'App\\Models\\Article', mediable_id: articleId, tag: 'media', order: 0 });
      await connection.execute('UPDATE articles SET content = CONCAT(content, ?) WHERE id = ?', [`<p><a href="https://storage.happytohelp.com/${projectId}/articles/diagram.txt">Diagram</a></p>`, articleId]);
    }
    await insert('articles', { id: uuid('73', n), project_id: projectId, title: `${name} unpublished checklist`,
      slug: `${slug}-unpublished-checklist`, content: '<p>Draft guidance awaiting review.</p>', created_by_id: ownerId, ...times });
    await insert('article_categories', { id: uuid('74', n), article_id: articleId, category_id: categoryId, ...times });
    await insert('article_categories', { id: uuid('75', n), article_id: articleId, category_id: draftCategoryId, ...times });
    await insert('article_categories', { id: uuid('76', n), article_id: uuid('73', n), category_id: draftCategoryId, ...times });
    await seedExtendedLegacy(insert,{projectId,n,slug,name,ownerId,aiId,contactId,conversationId,bucketId,messageId:messageIds[2]});
    await insert('macros', { id: uuid('90', n), project_id: projectId, created_by_id: ownerId,
      title: `${name} billing reply`, content: `Thanks for contacting ${name}. Please open your billing page to download invoices.`, ...times });
  }
  return { projectIds: [...projectIds], ownerId, counts, secrets:PLANTED_SECRETS };
}
