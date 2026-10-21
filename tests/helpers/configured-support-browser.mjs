import assert from 'node:assert/strict';

/** Continue the existing knowledge/AI journeys through the operator's ordinary controls. */
export async function configuredSupportBrowser({browser, runtime, owner, project, call, evidence}) {
    // An assistant on a provider this installation has no key for cannot take a conversation.
    const keyless = (await call(`/api/management/projects/${owner.projectId}/ais`, {name: 'Claude specialist', role: 'Support assistant', prompt: 'Answer support questions.', model: 'claude-sonnet-5'}, owner.token)).data;
    for (const width of [1440, 390]) {
        const context = await browser.newContext({viewport: {width, height: 960}}), page = await context.newPage();
        try {
            await context.addCookies([{name: 'h2h_session', value: owner.token, url: runtime.origin}]);
            const base = `/projects/${owner.projectId}`;
            await page.goto(runtime.origin + base + '/edit');
            await page.getByLabel('Offer proactive help after visitor consent', {exact: true}).waitFor();
            await page.getByLabel('Offer proactive help after visitor consent', {exact: true}).uncheck();
            await page.getByLabel('Offer proactive help after visitor consent', {exact: true}).check();
            const saved=page.waitForResponse(response=>response.request().method()==='PUT'&&new URL(response.url()).pathname.endsWith('/settings'));
            await page.getByRole('button', {name: 'Update', exact: true}).click();
            await saved;
            if(width===390)await page.getByLabel('Offer proactive help after visitor consent',{exact:true}).scrollIntoViewIfNeeded();
            await page.screenshot({path: `${evidence}/monitoring-settings-${width}.png`, fullPage: width!==390});
            await page.goto(runtime.origin + base + '/datasets/create');
            await page.getByLabel('Starting URL', {exact: true}).fill('https://support.example.test');
            await page.getByLabel('Excluded URLs', {exact: true}).fill('https://support.example.test/private/**');
            await page.getByLabel('Max Crawl Depth', {exact: true}).fill('2');
            await page.getByLabel('Max Crawl Pages', {exact: true}).fill('25');
            await page.screenshot({path: `${evidence}/add-url-${width}.png`, fullPage: true});
            await page.getByRole('button', {name: 'Add URL', exact: true}).click();
            await page.waitForURL(/\/datasets\/[^/]+$/);
            await page.getByText('Ready for AI answers', {exact: true}).waitFor({timeout: 90000});
            await page.screenshot({path: `${evidence}/crawl-ready-${width}.png`, fullPage: true});
            const corpus = await call(`/api/knowledge/${owner.projectId}/search?q=API%20credential`, undefined, owner.token);
            assert.ok(corpus.citations.some(item => item.url === 'https://support.example.test/api-credentials'));

            const visitor = await call('/api/identity/widget/session', {widgetKey: project.widget_key, name: 'Maya Chen'}, undefined);
            const conversation = await call('/api/conversations', {projectId: owner.projectId}, visitor.token);
            await call(`/api/dashboard/projects/${owner.projectId}/conversations/${conversation.id}`, {agent_id: owner.userId, ai_id: null}, owner.token, 'PUT');
            await call(`/api/conversations/${conversation.id}/messages`, {localId: 'waiting-' + width, content: 'I cannot find the API credential for our Northstar integration. Where should I look?', expectedRevision: 0, expectedLastMessageId: null}, visitor.token);
            await page.goto(runtime.origin + base + '/conversations/' + conversation.id);
            const panel=page.getByRole('button',{name:/^(Show|Hide) conversation panel$/});
            if(await panel.getAttribute('aria-expanded')==='false')await panel.click();
            await page.getByRole('tab',{name:'Ticket',exact:true}).click();
            const assignment = page.getByRole('button', {name: /Assign conversation\. Current assignment:/});
            const human = await assignment.getAttribute('aria-label');
            await assignment.click();
            await page.getByRole('menuitem', {name: keyless.name, exact: false}).click();
            await page.getByRole('alert').filter({hasText: 'ANTHROPIC_API_KEY'}).waitFor();
            assert.equal(await assignment.getAttribute('aria-label'), human, 'a refused handoff stays visibly with the human');
            await page.screenshot({path: `${evidence}/handoff-nokey-${width}.png`, fullPage: true});
            await assignment.click();
            const assistant = (await call('/api/management/bootstrap', undefined, owner.token)).ais.find(item => item.is_enabled && item.id !== keyless.id);
            await page.getByRole('menuitem', {name: assistant.name, exact: false}).click();
            if(await panel.getAttribute('aria-expanded')==='true')await page.locator('#conversation-assistant').getByRole('button',{name:'Hide',exact:true}).click();
            await page.waitForTimeout(500);
            const answer = page.getByText('Open Workspace settings, choose API credentials, and create a credential. Copy it into your integration, then check the connection again.', {exact: true}).first();
            await answer.waitFor({timeout: 30000});
            await page.screenshot({path: `${evidence}/handoff-answer-${width}.png`, fullPage: true});
            const transcript = await call(`/api/conversations/${conversation.id}/messages`, undefined, owner.token);
            assert.equal(transcript.messages.filter(message => message.actor_role === 'ai').length, 1, 'handoff emits one durable answer');
        } catch(error) { await page.screenshot({path:`${evidence}/configured-failure-${width}.png`,fullPage:true}); throw error; } finally { await context.close(); }
    }
}
