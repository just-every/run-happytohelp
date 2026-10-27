import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRuntime} from '../emitted-runtime.mjs';
import {buildInboxFixture} from '../inbox-conversation-fixture.mjs';
import {startNoteFocusTrace, assertNoteFocusTrace, checkHeldNoteKeys} from '../note-busy-focus-trace.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs'

export async function noteBusyFocus(){

const evidence = resolve(process.env.H2H_EVIDENCE_DIR || join(tmpdir(), 'h2h-note-busy-focus'));
await mkdir(evidence, {recursive: true});
const records = [], errors = [], cleanup = {};
let runtime, browser, success = false;
try {
    runtime = await createRuntime();
    const fixture = await buildInboxFixture(runtime.origin);
    const conversationId = fixture.contacts.draft.id;
    const apiPath = `/api/dashboard/projects/${fixture.projectId}/conversations/${conversationId}`;
    const notes = async () => (await fixture.api(`${apiPath}/buckets/${conversationId}`)).data.events.filter(event => event.type === 'INTERNAL_NOTE');
    browser = await launchBrowser();
    for (const viewport of [{width: 1440, height: 900}, {width: 390, height: 844}]) {
        const context = await browser.newContext({viewport});
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on('pageerror', error => errors.push(error.message));
        const target = `/projects/${fixture.projectId}/conversations/${conversationId}`;
        await page.goto(runtime.origin + '/login?' + new URLSearchParams({returnTo: target}));
        await page.getByLabel('Email', {exact: true}).fill(fixture.owner.email);
        await page.getByLabel('Password', {exact: true}).fill(fixture.owner.password);
        await page.getByRole('button', {name: 'Login', exact: true}).click();
        await page.waitForURL(url => url.pathname === target);
        const dialog = page.getByRole('dialog', {name: 'Add Note'});
        const open = async () => {
            await page.getByRole('button', {name: 'Actions', exact: true}).click();
            await page.getByRole('menuitem', {name: 'Internal note', exact: true}).click();
            await dialog.waitFor();
        };
        const pattern = '**' + apiPath + '/notes';
        const content = `Private native focus regression note ${viewport.width}`;
        let posts = 0, release, held = new Promise(resolveHeld => { release = resolveHeld; });
        let respondWithError = true;
        const pendingRoutes = [];
        const arrivals = [Promise.withResolvers(), Promise.withResolvers()];
        const waitForSubmission = async index => {
            let timer;
            try {
                await Promise.race([arrivals[index].promise, new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('Note POST did not reach the held route')), 15000);
                })]);
            } finally { clearTimeout(timer); }
        };
        const handler = route => {
            const operation = (async () => {
                posts++;
                assert.equal(route.request().method(), 'POST');
                assert.deepEqual(route.request().postDataJSON(), {content, mention_ids: [], media_ids: []});
                arrivals[posts - 1]?.resolve();
                await held;
                if (respondWithError) await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({message: 'Synthetic note service failure'})});
                else await route.continue(); // Original request reaches the actual emitted Worker unchanged.
            })();
            pendingRoutes.push(operation);
            return operation;
        };
        await page.route(pattern, handler);
        try {
            await open();
            await dialog.getByLabel('Note', {exact: true}).fill(content);
            await startNoteFocusTrace(dialog);
            await dialog.getByRole('button', {name: 'Add', exact: true}).click();
            await page.waitForFunction(() => window.noteFocusTrace.trace.commits.some(commit => commit.busy));
            const commitTrace = await page.evaluate(() => window.noteFocusTrace.trace);
            await writeFile(join(evidence, `${viewport.width}-instant-busy-focus.json`), JSON.stringify(commitTrace, null, 2));
            assertNoteFocusTrace(commitTrace);
            // A busy React commit precedes delivery to Playwright's route handler.
            // Observe that boundary before checking duplicate submissions.
            await waitForSubmission(0);
            await checkHeldNoteKeys(page, dialog);
            assert.equal(posts, 1, 'one user submission while held');
            const errorTrace = await page.evaluate(() => window.noteFocusTrace.stop());
            assertNoteFocusTrace(errorTrace);
            release();
            await dialog.getByRole('alert').filter({hasText: 'Synthetic note service failure'}).waitFor();
            assert.equal(await dialog.getByLabel('Note', {exact: true}).inputValue(), content);
            assert.equal(await dialog.locator('button:not(:disabled), textarea:not(:disabled)').count(), 4);
            assert.equal(await dialog.locator('form').getAttribute('aria-busy'), 'false');
            assert.equal((await notes()).filter(note => note.content === content).length, 0, 'failed attempt writes no note');
            await page.keyboard.press('Tab');
            await page.keyboard.press('Shift+Tab');
            assert.equal(posts, 1, 'error recovery never automatically replays POST');

            respondWithError = false;
            held = new Promise(resolveHeld => { release = resolveHeld; });
            await startNoteFocusTrace(dialog);
            const add = dialog.getByRole('button', {name: 'Add', exact: true});
            await add.focus();
            await page.keyboard.press('Enter'); // Explicit user retry, with a keyboard submission.
            await page.waitForFunction(() => window.noteFocusTrace.trace.commits.some(commit => commit.busy));
            assertNoteFocusTrace(await page.evaluate(() => window.noteFocusTrace.trace));
            await waitForSubmission(1);
            await checkHeldNoteKeys(page, dialog);
            assert.equal(posts, 2, 'one explicit retry POST');
            const successTrace = await page.evaluate(() => window.noteFocusTrace.stop());
            assertNoteFocusTrace(successTrace);
            release();
            await dialog.waitFor({state: 'detached'});
            await page.getByText(content, {exact: true}).waitFor();
            assert.equal((await notes()).filter(note => note.content === content).length, 1, 'one durable private note');
            await page.reload();
            await page.getByText(content, {exact: true}).waitFor();
            const transcript = await fixture.api(`/api/conversations/${conversationId}/messages`);
            assert.ok(!JSON.stringify(transcript).includes(content), 'private note does not leak into message transcript');
            records.push({viewport, posts, transport: '503 test boundary then held unchanged native POST', errorTrace, successTrace});
            await writeFile(join(evidence, `${viewport.width}-focus-traces.json`), JSON.stringify(records.at(-1), null, 2));
            await page.screenshot({path: join(evidence, `${viewport.width}-durable-note.png`)});
        } finally {
            release();
            await Promise.all(pendingRoutes);
            await page.unroute(pattern, handler);
        }
        for (const dismiss of ['Escape', 'header Close', 'footer Close']) {
            const before = (await notes()).length;
            await open();
            await dialog.getByLabel('Note', {exact: true}).fill(`Discarded ${dismiss} ${viewport.width}`);
            if (dismiss === 'Escape') await page.keyboard.press('Escape');
            else await dialog.getByRole('button', {name: 'Close', exact: true}).nth(dismiss === 'header Close' ? 0 : 1).click();
            await dialog.waitFor({state: 'detached'});
            assert.equal(await page.getByRole('button', {name: 'Actions', exact: true}).evaluate(element => document.activeElement === element), true);
            assert.equal((await notes()).length, before, `${dismiss} discards note without writing`);
        }
        await context.close();
    }
    assert.deepEqual(errors, []);
    success = true;
    console.log(JSON.stringify({widths: records.map(record => record.viewport.width), busyTransitions: 4, posts: records.map(record => record.posts), migrationCount: runtime.migrationCount, errors}, null, 2));
} finally {
    if (browser) { await browser.close(); cleanup.browserClosed = true; }
    if (runtime) { await runtime.close(success); cleanup.workerClosed = true; }
    await writeFile(join(evidence, 'note-busy-focus-summary.json'), JSON.stringify({success, records, errors, cleanup}, null, 2));
}

}
