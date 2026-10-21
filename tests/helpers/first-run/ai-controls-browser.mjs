import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntime } from '../emitted-runtime.mjs';
import { navigationFixture } from '../navigation-fixture.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs';

export async function aiControlsBrowser(){
 const evidence = join(
     process.env.H2H_EVIDENCE_DIR ? resolve(process.env.H2H_EVIDENCE_DIR) : await mkdtemp(join(tmpdir(), 'h2h-activation-ai-controls-')),
     'activation-ai-controls',
 );
 await mkdir(evidence, { recursive: true });
 const optionalPort = name => process.env[name] ? Number(process.env[name]) : undefined;
 const runtime = await createRuntime({
     port: optionalPort('H2H_RUNTIME_PORT') ?? optionalPort('H2H_TEST_PORT') ?? 0,
     inspectorPort: optionalPort('H2H_RUNTIME_INSPECTOR_PORT'),
 });
 const browser = await launchBrowser();
 const checks = [], errors = [];
 let success = false;
 let currentPage;

 const quote = value => value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
 const call = async (origin, path, body, token, method = body === undefined ? 'GET' : 'POST') => {
     const response = await fetch(origin + path, {
         method,
         headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
         body: body === undefined ? undefined : JSON.stringify(body),
     });
     const payload = await response.json();
     assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
     return payload;
 };

 try {
     const fixture = await navigationFixture(runtime.origin);
     const projectId = fixture.projects[0].id;
     const conversationId = fixture.projects[0].conversationId;
     const owner = await call(runtime.origin, '/api/identity/login', {
         email: 'navigation@example.test',
         password: 'synthetic-navigation-regression-password-2026',
     });
     const conversationPath = `/projects/${projectId}/conversations/${conversationId}`;
     const conversation = (await call(
         runtime.origin,
         `/api/dashboard/projects/${projectId}/conversations/${conversationId}`,
         undefined,
         owner.token,
     )).data;
     const aiId = crypto.randomUUID();
     const profile = { id: aiId, model: 'gpt-5.6-luna', prompt: 'Draft from the provided conversation.' };
     const now = new Date().toISOString();
     await runtime.execute([
         `INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,is_enabled,created_at) VALUES(${[
             aiId, projectId, 'Fixture assistant', 'support', profile.prompt, profile.model, 1, Date.now(),
         ].map(quote).join(',')})`,
         `INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES(${quote(projectId)},${quote(JSON.stringify({ default_visitor_ai_id: aiId, default_verified_user_ai_id: aiId }))},${Date.now()}) ON CONFLICT(project_id) DO UPDATE SET settings_json=json_set(project_settings.settings_json,'$.default_visitor_ai_id',${quote(aiId)},'$.default_verified_user_ai_id',${quote(aiId)}),updated_at=excluded.updated_at`,
         `INSERT INTO conversation_ai(conversation_id,ai_id) VALUES(${quote(conversationId)},${quote(aiId)}) ON CONFLICT(conversation_id) DO UPDATE SET ai_id=excluded.ai_id`,
     ].join(';'));

     const addGenerationState = async (state, { error = null, result = null } = {}) => {
         const output = result === null ? null : JSON.stringify({ result });
         const id = crypto.randomUUID();
         const values = [
             id, projectId, conversationId, state, conversation.revision, 0,
             conversation.last_message_id, JSON.stringify({ id: 'fixture-owner', projectId, role: 'owner' }),
             profile.model, aiId, JSON.stringify(profile), 'suggestions', '', '{}', now, now, error, output,
         ];
         await runtime.execute(`INSERT INTO ai_generations(id,project_id,conversation_id,state,source_revision,source_context_revision,source_last_message_id,actor_json,model,ai_id,ai_profile_json,kind,instruction,options_json,created_at,updated_at,error,output_json) VALUES(${values.map(quote).join(',')})`);
     };
     const providerFixtureResponse = {
         responses: [{
             button: 'Fixture answer',
             icon: 'circle-question-mark',
             response: 'The fixture response stays a draft until an operator presses Send.',
             use_when: '',
             evidence_ids: ['message:fixture'],
         }],
         user_goal: 'Answer the visitor',
         missing_information: [],
     };

     const noMessageConversationId = crypto.randomUUID();
     const noMessageContactId = crypto.randomUUID();
     const createdAt = Date.now();
     await runtime.execute([
         `INSERT INTO contacts(id,project_id,name,email,external_id,created_at) VALUES(${[
             noMessageContactId, projectId, 'No message visitor', null, `activation-ai-${noMessageContactId}`, createdAt,
         ].map(quote).join(',')})`,
         `INSERT INTO conversations(id,project_id,contact_id,revision,last_message_id,created_at,updated_at) VALUES(${[
             noMessageConversationId, projectId, noMessageContactId, 0, null, createdAt, createdAt,
         ].map(quote).join(',')})`,
     ].join(';'));

     for (const { width, height } of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
         await addGenerationState('completed', { result: providerFixtureResponse });
         const context = await browser.newContext({ viewport: { width, height } });
         const page = await context.newPage();
         currentPage = page;
         page.setDefaultTimeout(15000);
         page.on('pageerror', error => errors.push(`${width}px: ${error.message}`));
         await page.goto(runtime.origin + '/login?' + new URLSearchParams({ returnTo: conversationPath }));
         await page.getByLabel('Email', { exact: true }).fill('navigation@example.test');
         await page.getByLabel('Password', { exact: true }).fill('synthetic-navigation-regression-password-2026');
         await page.getByRole('button', { name: 'Login', exact: true }).click();
         await page.waitForURL(url => url.pathname === conversationPath);

         const panel = page.locator('#conversation-assistant');
         const panelEntry = page.locator('.conversation-assistant-toggle');
         await panelEntry.waitFor({ state: 'visible' });
         assert.equal(await panelEntry.count(), 1, `${width}px: one labelled conversation panel entry`);
         assert.match(await panelEntry.getAttribute('aria-label'), /^(Show|Hide) conversation panel$/);
         if (width < 1280) {
             await panel.waitFor({ state: 'hidden' });
             assert.equal(await panelEntry.getAttribute('aria-label'), 'Show conversation panel');
             await panelEntry.click();
         }
         await page.waitForFunction(() => document.querySelector('#conversation-assistant')?.getAttribute('aria-hidden') === 'false');
         await panel.getByRole('tab', { name: 'Delegate', exact: true }).waitFor({ state: 'visible' });
         assert.equal(await panel.getByRole('tab', { name: 'Delegate', exact: true }).count(), 1, `${width}px: Delegate appears once as a panel tab`);
         assert.equal(await page.locator('.conversation-header').getByRole('button', { name: 'Delegate', exact: true }).count(), 0, `${width}px: no duplicate Delegate header button`);
         assert.equal(await page.locator('[data-ai-generate="true"]').count(), 1, `${width}px: one Generate control with a result`);
         await page.getByRole('button', { name: 'Fixture answer' }).waitFor();

         await page.getByRole('tab', { name: 'Ticket', exact: true }).click();
         assert.equal(await page.locator('#conversation-details-panel').isVisible(), true, `${width}px: Ticket is reachable`);
         await page.getByRole('tab', { name: 'Delegate', exact: true }).click();
         assert.equal(await page.locator('#conversation-local-panel').isVisible(), true, `${width}px: Local delegation is reachable`);
         await page.getByRole('tab', { name: 'Suggest', exact: true }).click();
         checks.push(`${width}px: single labelled panel entry opens Suggest, Ticket, and Delegate tabs`);

         const before = (await call(
             runtime.origin,
             `/api/dashboard/projects/${projectId}/conversations/${conversationId}`,
             undefined,
             owner.token,
         )).data;
         await page.getByRole('button', { name: 'Fixture answer' }).click();
         const composer = page.getByRole('textbox', { name: 'Reply to conversation' });
         assert.equal(await composer.inputValue(), providerFixtureResponse.responses[0].response);
         const after = (await call(
             runtime.origin,
             `/api/dashboard/projects/${projectId}/conversations/${conversationId}`,
             undefined,
             owner.token,
         )).data;
         assert.equal(after.revision, before.revision, `${width}px: selecting a suggestion does not Send it`);
         assert.equal(after.last_message_id, before.last_message_id, `${width}px: the visitor transcript remains unchanged`);
         assert.equal(await page.locator('[data-ai-generate="true"]').count(), 1, `${width}px: one Generate control with a selected draft`);
         checks.push(`${width}px: fixture suggestion enters the composer as an unsent human draft`);

         await composer.fill('Keep this operator draft while showing the provider error.');
         await page.locator('[data-ai-generate="true"]').click();
         await page.getByText('Add OPENAI_API_KEY', { exact: true }).waitFor();
         assert.equal(await composer.inputValue(), 'Keep this operator draft while showing the provider error.');
         assert.equal(await page.locator('[data-ai-generate="true"]').count(), 1, `${width}px: provider error has no second retry control`);
         assert.equal(await page.locator('.conversation-suggestions__error button').count(), 0, `${width}px: provider error has no contextual retry`);
         assert.ok(await page.locator('.conversation-suggestions__error').getByRole('link').count() > 0, `${width}px: provider setup includes an actionable configuration link`);
         checks.push(`${width}px: real CONFIGURATION_REQUIRED response names its missing provider secret and preserves the draft`);

         await addGenerationState('uncertain', { error: 'Provider outcome is uncertain; this attempt was not replayed.' });
         await page.reload();
         if (width < 1280) {
             await panel.waitFor({ state: 'hidden' });
             await panelEntry.click();
         }
         await page.getByText('Provider outcome is uncertain; this attempt was not replayed.', { exact: true }).waitFor();
         assert.equal(await page.locator('[data-ai-generate="true"]').count(), 1, `${width}px: uncertain generation keeps one explicit action`);
         assert.equal(await page.getByText(/OPENAI_API_KEY/).count(), 0, `${width}px: an unknown outcome is not mislabelled as missing configuration`);
         checks.push(`${width}px: persisted uncertain outcome stays visible without automatic replay or provider-missing guidance`);

         await addGenerationState('queued');
         await page.reload();
         if (width < 1280) {
             await panel.waitFor({ state: 'hidden' });
             await panelEntry.click();
         }
         const generating = page.locator('[data-ai-generate="true"]');
         await page.getByRole('status').getByText('Generating reply suggestions…').waitFor();
         assert.equal(await generating.count(), 1, `${width}px: loading has one Generate control`);
         assert.equal(await generating.isDisabled(), true, `${width}px: no duplicate action while generation is active`);
         assert.equal(await generating.getAttribute('aria-busy'), 'true');
         checks.push(`${width}px: queued generation retains one disabled, busy Generate control`);

         await addGenerationState('cancelled', { error: 'Generation cancelled before a result was confirmed.' });
         await page.reload();
         if (width < 1280) {
             await panel.waitFor({ state: 'hidden' });
             await panelEntry.click();
         }
         await page.getByText('Generation cancelled before a result was confirmed.', { exact: true }).waitFor();
         assert.equal(await page.locator('[data-ai-generate="true"]').count(), 1, `${width}px: cancellation retains one explicit action`);
         checks.push(`${width}px: cancellation remains visible in the single-action layout`);

         await page.goto(runtime.origin + `/projects/${projectId}/conversations/${noMessageConversationId}`);
         await page.waitForURL(url => url.pathname === `/projects/${projectId}/conversations/${noMessageConversationId}`);
         if (width < 1280) {
             await page.waitForFunction(() => document.querySelector('#conversation-assistant')?.getAttribute('aria-hidden') === 'true');
             await panelEntry.click();
         }
         await page.getByRole('status').filter({ hasText: /^Add a customer message first\.$/ }).waitFor();
         assert.equal(await page.locator('[data-ai-generate="true"]').count(), 1, `${width}px: empty conversation has one Generate control`);
         assert.equal(await page.locator('[data-ai-generate="true"]').isDisabled(), true, `${width}px: empty conversation cannot request generation`);
         checks.push(`${width}px: no-message hint disables the only Generate control`);

         if (width < 1280) {
             const hide = panel.getByRole('button', { name: 'Hide', exact: true });
             await hide.waitFor();
             await hide.focus();
             await page.keyboard.press('Escape');
             await panel.waitFor({ state: 'hidden' });
             assert.equal(await panelEntry.evaluate(element => element === document.activeElement), true, 'Escape restores focus to the labelled panel entry');
             await panelEntry.click();
             await panel.waitFor();
             const controls = panel.locator('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]');
             await controls.last().focus();
             await page.keyboard.press('Tab');
             assert.equal(await panel.evaluate(element => element.contains(document.activeElement)), true, 'Tab remains inside the mobile panel');
             await page.setViewportSize({ width: 1440, height: 960 });
             await page.waitForFunction(() => document.querySelector('#conversation-assistant')?.getAttribute('aria-hidden') === 'false');
             await page.setViewportSize({ width: 390, height: 844 });
             await page.waitForFunction(() => document.querySelector('#conversation-assistant')?.getAttribute('aria-hidden') === 'true');
             checks.push('390px: sheet opens, tabs contain focus, Escape restores focus, and resize closes the sheet');
         } else {
             await page.getByRole('tab', { name: 'Suggest', exact: true }).focus();
             await page.keyboard.press('ArrowRight');
             assert.equal(await page.getByRole('tab', { name: 'Delegate', exact: true }).getAttribute('aria-selected'), 'true');
             await page.getByRole('tab', { name: 'Suggest', exact: true }).focus();
             await page.keyboard.press('End');
             assert.equal(await page.getByRole('tab', { name: 'Ticket', exact: true }).getAttribute('aria-selected'), 'true');
             checks.push('1440px: panel tabs preserve arrow and End keyboard navigation');
         }

         await page.screenshot({ path: join(evidence, `${width}.png`), fullPage: true });
         await context.close();
     }

     assert.deepEqual(errors, []);
     success = true;
 } finally {
     if (!success && currentPage && !currentPage.isClosed()) {
         await currentPage.screenshot({ path: join(evidence, 'failure.png'), fullPage: true });
         await writeFile(join(evidence, 'failure.txt'), await currentPage.locator('body').innerText());
     }
     await writeFile(join(evidence, 'result.json'), JSON.stringify({ success, checks, errors }, null, 2) + '\n');
     await browser.close();
     await runtime.close(success);
 }

 console.log('Activation AI controls browser checks passed:', evidence);
}
