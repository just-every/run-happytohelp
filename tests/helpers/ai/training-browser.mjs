import assert from 'node:assert/strict'
import {holdNativeResponse} from '../training-readiness.mjs'

// The evaluation runs page shows only real native state: loading and failures are never a fabricated list,
// recovery is explicit, stale responses never repaint, and a pending creation is never replayed.
export async function trainingBrowserJourney({runtime,browser,shot}){
 const checks=[],holds=[],pass=name=>checks.push(name)
 try{
    const api = async (path, body, token) => {
        const response = await fetch(runtime.origin + path, {method: body ? 'POST' : 'GET', headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
        assert.ok(response.ok, path + ': ' + response.status + ' ' + await response.clone().text());
        return response.json();
    };
    const owner = {email: 'training-readiness@example.test', password: 'synthetic-native-training-readiness-2026'};
    const setup = await api('/api/identity/bootstrap', {...owner, name: 'Training Alpha', allowedOrigin: runtime.origin});
    const {token} = await api('/api/identity/login', owner);
    const beta = await api('/api/management/projects', {name: 'Training Beta', allowed_origin: runtime.origin}, token);
    const path = `/api/training/projects/${setup.projectId}/runs`, betaPath = `/api/training/projects/${beta.id}/runs`;
    const url = `${runtime.origin}/projects/${setup.projectId}/training-runs`;
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    await context.addCookies([{name: 'h2h_session', value: token, url: runtime.origin}]);
    const page = await context.newPage(), posts = [], gets = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    page.on('request', request => {
        const requestPath = new URL(request.url()).pathname;
        if (!requestPath.startsWith('/api/training/')) return;
        if (request.method() === 'POST') posts.push(requestPath);
        if (request.method() === 'GET') gets.push(requestPath);
    });
    const hold = async (resource, method) => { const pending = await holdNativeResponse(page, resource, method); holds.push(pending); return pending; };
    const createButton = page.getByRole('button', {name: 'Create run', exact: true});
    const tabs = page.getByRole('navigation', {name: 'Knowledge sections'});

    for (const width of [1440, 390]) {
        await page.setViewportSize({width, height: width === 390 ? 844 : 1000});
        const delayed = await hold(path);
        await page.goto(url); await delayed.responseReady;
        await page.getByText('Loading evaluation runs…', {exact: true}).waitFor();
        await assertUnavailable(page, posts);
        await page.screenshot({path: shot(`training-${width}-loading.png`), fullPage: true});
        delayed.release(); await delayed.deliveryDone; await createButton.waitFor();
        assert.ok(await createButton.isEnabled());
        assert.match(await page.locator('.workspace-page-content').innerText(), /No evaluation runs yet/);
        await delayed.close();
        pass(`${width}: delayed actual empty GET shows loading, no fabricated list or available creation, then real empty state`);

        let failedReads = 0;
        const fail = async route => { failedReads++; await route.abort('failed'); };
        await page.route('**' + path, fail);
        await page.reload(); await page.getByRole('alert').waitFor();
        await assertUnavailable(page, posts);
        await settleFrames(page); assert.equal(failedReads, 1, 'failed GET is not retried automatically');
        await page.screenshot({path: shot(`training-${width}-load-error.png`), fullPage: true});
        await page.unroute('**' + path, fail);
        const recovery = await hold(path);
        await page.getByRole('button', {name: 'Load runs', exact: true}).click();
        await recovery.responseReady; await assertUnavailable(page, posts);
        recovery.release(); await recovery.deliveryDone; await createButton.waitFor();
        assert.ok(await createButton.isEnabled()); assert.equal(await page.getByRole('alert').count(), 0);
        await recovery.close();
        pass(`${width}: failed initial GET remains unavailable; only explicit Load runs performs a real GET and clears the error`);
    }
    await page.setViewportSize({width: 1440, height: 1000});

    // An older real empty list must not replace the newer list after client navigation.
    const staleList = await hold(path);
    await page.reload(); await staleList.responseReady;
    const stamp = await page.evaluate(() => performance.timeOrigin);
    await tabs.getByRole('link', {name: 'Articles', exact: true}).click();
    await page.getByRole('heading', {name: 'Knowledge', exact: true}).waitFor();
    const seeded = await api(path, {request_id: crypto.randomUUID(), kind: 'simulation', models: ['gpt-5.6-luna'], cases: [{id: 'stale-list-case'}], max_cost: 5, max_tokens: 2000}, token);
    await tabs.getByRole('link', {name: 'Evaluation runs', exact: true}).click();
    await page.getByRole('button', {name: 'Simulation', exact: true}).waitFor();
    staleList.release(); await staleList.deliveryDone; await settleFrames(page);
    assert.equal(await page.getByRole('button', {name: 'Simulation', exact: true}).count(), 1);
    assert.doesNotMatch(await page.locator('.workspace-page-content').innerText(), /No evaluation runs yet/);
    assert.equal(await page.evaluate(() => performance.timeOrigin), stamp, 'stale list regression keeps the same browser document');
    await staleList.close();
    pass('older real empty GET cannot overwrite the newer native run list after client navigation');

    // Creation succeeded, but its list refresh failed: retain the receipt and require an explicit read.
    await fillTrainingRun(page);
    const failRefresh = async route => route.request().method() === 'GET' ? route.abort('failed') : route.continue();
    await page.route('**' + path, failRefresh);
    await createButton.click(); await page.getByRole('alert').waitFor();
    await page.getByText('Run created.', {exact: false}).waitFor();
    assert.ok(await createButton.isDisabled(), 'failed list refresh does not enable another creation');
    await page.locator('.workspace-settings .training-run-form').evaluate(form => form.requestSubmit());
    assert.deepEqual(posts, [path], 'programmatic submit cannot create while refresh failed');
    await page.unroute('**' + path, failRefresh);
    const refresh = await hold(path);
    await page.getByRole('button', {name: 'Load runs', exact: true}).click(); await refresh.responseReady;
    assert.ok(await createButton.isDisabled(), 'explicit delayed recovery keeps creation disabled');
    await page.locator('.workspace-settings .training-run-form').evaluate(form => form.requestSubmit());
    assert.deepEqual(posts, [path]);
    refresh.release(); await refresh.deliveryDone;
    await page.getByRole('button', {name: 'Evaluation', exact: true}).waitFor();
    assert.ok(await createButton.isEnabled());
    const loaded = (await api(path, undefined, token)).data;
    assert.equal(loaded.length, 2, 'explicit GET recovers the committed run without replay');
    await refresh.close();
    pass('committed creation plus failed refresh retains success/error, blocks programmatic POST and recovers only by explicit native GET');

    // In the same mounted list, the last chosen details win even when the first read finishes later.
    const evaluation = loaded.find(run => run.kind === 'evaluation');
    const evaluationCase = (await api(path + '/' + evaluation.id, undefined, token)).data.cases[0].id;
    const oldSelection = await hold(path + '/' + seeded.data.id);
    await page.getByRole('button', {name: 'Simulation', exact: true}).click();
    const simulationCase = (await (await oldSelection.responseReady).json()).data.cases[0].id;
    await page.getByRole('button', {name: 'Evaluation', exact: true}).click();
    await page.getByRole('heading', {name: evaluationCase, exact: true}).waitFor();
    oldSelection.release(); await oldSelection.deliveryDone; await settleFrames(page);
    assert.equal(await page.getByRole('heading', {name: evaluationCase, exact: true}).count(), 1);
    assert.equal(await page.getByRole('heading', {name: simulationCase, exact: true}).count(), 0);
    await oldSelection.close();
    pass('out-of-order native detail responses preserve the latest selected run');

    // An older detail response cannot repopulate the current project after switching.
    const staleDetail = await hold(path + '/' + seeded.data.id);
    await page.getByRole('button', {name: 'Simulation', exact: true}).click(); await staleDetail.responseReady;
    await switchTrainingProject(page, 'Training Beta', beta.id); await createButton.waitFor();
    staleDetail.release(); await staleDetail.deliveryDone; await settleFrames(page);
    assert.equal(await page.getByRole('heading', {name: 'Run details', exact: true}).count(), 0);
    assert.match(await page.locator('.workspace-page-content').innerText(), /No evaluation runs yet/);
    assert.equal(await page.evaluate(() => performance.timeOrigin), stamp);
    await staleDetail.close();
    pass('delayed native details cannot appear in another project after same-document navigation');

    await switchTrainingProject(page, 'Training Alpha', setup.projectId); await createButton.waitFor();
    await fillTrainingRun(page);
    const post = await hold(path, 'POST');
    await createButton.click(); const committed = await post.responseReady;
    assert.equal(committed.status(), 201, 'native POST committed once');
    assert.ok(await page.getByRole('button', {name: 'Creating…', exact: true}).isDisabled());
    await page.locator('.workspace-settings .training-run-form').evaluate(form => form.requestSubmit());
    assert.deepEqual(posts, [path, path], 'programmatic repeated submit cannot replay the pending POST');
    await switchTrainingProject(page, 'Training Beta', beta.id); await createButton.waitFor();
    const before = [...gets];
    post.release(); await post.deliveryDone; await settleFrames(page);
    assert.deepEqual(gets, before, 'stale POST completion sends no old-project refresh');
    assert.deepEqual(posts, [path, path], 'navigation and response delivery never replay the POST');
    assert.equal(await page.getByText('Run created.', {exact: false}).count(), 0, 'no stale success in the new project');
    assert.match(await page.locator('.workspace-page-content').innerText(), /No evaluation runs yet/);
    const betaSession = (await context.cookies()).find(cookie => cookie.name === 'h2h_session').value;
    assert.equal((await api(betaPath, undefined, betaSession)).data.length, 0, 'new project has no accidental run');
    assert.equal((await api(path, undefined, token)).data.length, 3, 'only the deliberate native run was added');
    await post.close();
    pass('one committed native POST while pending; disabled/programmatic submits and project navigation never replay it or publish stale success/refresh');

    assert.deepEqual(errors, [], 'no browser exceptions');
    await context.close();
 }finally{for(const held of holds)held.release()}
}

// Readiness assertions retained with the candidate browser journey after main
// reduced the shared helper to its native-response gate.
async function fillTrainingRun(page) {
    await page.getByLabel('Models', {exact: false}).first().fill('gpt-5.6-luna');
    await page.getByLabel('Case definitions', {exact: false}).fill('[{"id":"readiness-case","type":"customer-reply"}]');
    await page.getByLabel('Maximum cost', {exact: false}).fill('5');
    await page.getByLabel('Maximum tokens', {exact: false}).fill('2000');
}

async function settleFrames(page) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function assertUnavailable(page, posts) {
    assert.equal(await page.getByRole('button', {name: 'Create run', exact: true}).count(), 0, 'creation appears only after the real initial list');
    assert.equal(await page.getByLabel('Case definitions', {exact: false}).count(), 0, 'no editable draft before list readiness');
    assert.equal(await page.locator('table').count(), 0, 'loading/error is not an empty table');
    assert.doesNotMatch(await page.locator('.workspace-page-content').innerText(), /No evaluation runs yet/);
    assert.deepEqual(posts, [], 'no early training POST');
}

async function switchTrainingProject(page, name, projectId) {
    const nav = page.getByRole('navigation', {name: 'Main navigation'});
    await nav.getByRole('button', {name: /Switch workspace:/}).click();
    await nav.getByRole('button', {name, exact: true}).click();
    await page.waitForURL('**/projects/' + projectId + '/conversations');
    // The URL can change before the new workspace's scoped navigation commits.
    await nav.getByRole('button', {name: `Switch workspace: ${name}`, exact: true}).waitFor();
    await nav.getByRole('link', {name: 'Knowledge', exact: true}).and(page.locator(`a[href="/projects/${projectId}/articles"]`)).click();
    await page.getByRole('heading', {name: 'Knowledge', exact: true}).waitFor();
    await page.getByRole('navigation', {name: 'Knowledge sections'}).getByRole('link', {name: 'Evaluation runs', exact: true}).and(page.locator(`a[href="/projects/${projectId}/training-runs"]`)).click();
    await page.waitForURL('**/projects/' + projectId + '/training-runs');
}
