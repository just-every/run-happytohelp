import assert from 'node:assert/strict';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {checkNoteLoop, checkBrandingFocus, checkPopulatedArticle, submitBusyNote} from './accessibility-correction-flow.mjs';
import {measureFocusIndicator} from './accessibility-focus-contrast.mjs';
import {contrastRatio, svgBackgroundStrokeColor} from './accessibility-contrast.mjs';

export async function runDashboardAccessibility({browser, page, runtime, hostOrigin, call, axePath, audit, checks, errors, failedResponses, evidenceDir}) {
    const {scan, assertAxeClean, keyboardPass, measureLayout, measureContrast} = audit;
    let widgetConfig;
    const password = 'synthetic-accessibility-owner-password-2026';
    const email = 'accessibility-owner@example.test';
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) failedResponses.push({status: response.status(), path: new URL(response.url()).pathname}); });
    await page.addScriptTag({path: axePath});
    await page.goto(runtime.origin + '/setup');
    await page.getByLabel('Password', {exact: true}).waitFor();
    assertAxeClean(await scan(page, 'setup'), 'setup');
    await keyboardPass(page, 'setup', {count: 6});
    await measureContrast(page, 'setup', [
        {label: 'setup field label', selector: '.setup-field span'},
        {label: 'primary setup button', selector: '.setup-primary'},
    ]);
    checks.push('first-owner setup page rendered and axe scanned before account creation');

    widgetConfig = {
        apiOrigin: runtime.origin,
        widgetKey: 'pending-widget-key',
        open: false,
        settings: {await_consent: true, collector: {enabled: false}, collect: {require_name: true, require_email: true}},
    };
    const bootstrap = await call('/api/identity/bootstrap', {name: 'Accessibility workspace', email, password, allowedOrigin: hostOrigin});
    const owner = await call('/api/identity/login', {email, password});
    const project = await call(`/api/identity/projects/${bootstrap.projectId}`, undefined, owner.token);
    widgetConfig.widgetKey = project.widget_key;
    const customer = await call('/api/identity/widget/session', {widgetKey: project.widget_key, name: 'Keyboard Visitor', email: 'visitor@example.test'}, undefined, {Origin: hostOrigin});
    const conversation = await call('/api/conversations', {projectId: bootstrap.projectId}, customer.token);
    const mediaResponse = await fetch(`${runtime.origin}/api/conversations/${conversation.id}/media`, {method: 'POST', headers: {Authorization: `Bearer ${customer.token}`, 'Content-Type': 'text/plain', 'X-Filename': 'support-context.txt'}, body: 'Synthetic accessibility evidence attachment.'});
    assert.equal(mediaResponse.status, 201);
    const media = await mediaResponse.json();
    await call(`/api/conversations/${conversation.id}/messages`, {localId: 'accessibility-customer-1', content: 'I need help updating my account.', expectedRevision: 0, mediaIds: [media.id]}, customer.token);
    await call(`/api/conversations/${conversation.id}/messages`, {localId: 'accessibility-customer-2', content: 'The attached receipt shows the problem.', expectedRevision: 1}, customer.token);

    await page.goto(runtime.origin + '/login?returnTo=' + encodeURIComponent(`/projects/${bootstrap.projectId}/conversations`));
    await page.getByLabel('Email', {exact: true}).waitFor();
    // The public identity pages use the homepage look: a black pill action on paper (rgb(20, 20, 20) ink).
    await page.waitForFunction(() => document.querySelector('.h2h-identity .pill--ink')
        && getComputedStyle(document.querySelector('.h2h-identity .pill--ink')).backgroundColor === 'rgb(20, 20, 20)');
    assertAxeClean(await scan(page, 'login'), 'login');
    await keyboardPass(page, 'login', {count: 12});
    await measureContrast(page, 'login', [
        {label: 'email label', selector: 'label[for*="email"]'},
        {label: 'password label', selector: 'label[for*="password"]'},
        {label: 'primary login button', selector: '.h2h-identity .pill--ink'},
        {label: 'password-reset link', selector: 'a[href$="forgot-password"]'},
        {label: 'wordmark link', selector: '.h2h-identity .brand'},
    ]);
    await page.getByLabel('Email', {exact: true}).fill(email);
    await page.getByLabel('Password', {exact: true}).fill(password);
    await page.getByRole('button', {name: 'Login', exact: true}).click();
    await page.waitForURL('**/conversations');

    const inboxUrl = `${runtime.origin}/projects/${bootstrap.projectId}/conversations/${conversation.id}`;
    await page.goto(inboxUrl);
    await page.getByText('I need help updating my account.', {exact: true}).waitFor();
    const skipLink = page.getByRole('link', {name: 'Skip to main content', exact: true});
    await skipLink.focus();
    assert.ok(await skipLink.evaluate(element => element.getBoundingClientRect().top >= 0), 'dashboard skip link is not visible on focus');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'workspace-main', 'skip link did not move keyboard focus to the main region');
    await page.goto(inboxUrl);
    await page.getByText('I need help updating my account.', {exact: true}).waitFor();
    const inboxResult = await scan(page, 'dashboard-populated-inbox');
    assertAxeClean(inboxResult, 'dashboard populated inbox');
    await keyboardPass(page, 'dashboard-inbox');
    const desktopLayout = await measureLayout(page, 'dashboard-desktop');
    assert.equal(desktopLayout.horizontalOverflow, false, 'desktop conversation overflows horizontally');
    assert.equal(desktopLayout.targetsClipped.length, 0, `desktop dashboard controls remain clipped after bringing them into view: ${JSON.stringify(desktopLayout.targetsClipped)}`);
    assert.equal(desktopLayout.interactive.filter(item => !item.centerReachable).length, 0, 'desktop dashboard controls cannot be reached at their center');
    checks.push('populated inbox includes two real Worker messages and an uploaded attachment');

    const workspaceToggle = page.getByRole('button', {name: /Switch workspace:/});
    await workspaceToggle.click();
    const workspaceMenu = page.locator('.navbar-workspace-menu');
    await workspaceMenu.waitFor();
    const workspaceMenuResult = await scan(page, 'dashboard-project-switcher-open');
    assertAxeClean(workspaceMenuResult, 'project switcher');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.navbar-workspace-menu') === null);
    assert.equal(await workspaceToggle.evaluate(element => element === document.activeElement), true, 'workspace switcher Escape did not restore focus');
    checks.push('workspace switcher closes on Escape and restores trigger focus');

    const replyTools = page.getByRole('button', {name: 'Actions', exact: true});
    await replyTools.click();
    const toolsMenu = page.getByRole('menu', {name: 'Actions'});
    await toolsMenu.waitFor();
    assertAxeClean(await scan(page, 'dashboard-composer-tools-open'), 'composer tools');
    await page.getByRole('menuitem', {name: 'Internal note', exact: true}).click();
    const noteDialog = page.getByRole('dialog', {name: 'Add Note'});
    await noteDialog.waitFor();
    assertAxeClean(await scan(page, 'dashboard-note-dialog'), 'note dialog');
    await checkNoteLoop(page, evidenceDir);
    checks.push('settled note dialog completes three forward and three reverse four-control loops');
    const noteFocus = await page.evaluate(() => ({active: document.activeElement?.outerHTML?.slice(0, 240), visible: document.activeElement?.getBoundingClientRect().width > 0}));
    await page.keyboard.press('Escape');
    await noteDialog.waitFor({state: 'detached'});
    const noteRestored = await page.evaluate(() => ({active: document.activeElement?.outerHTML?.slice(0, 240), label: document.activeElement?.getAttribute('aria-label') || document.activeElement?.innerText?.trim()}));
    assert.equal(await replyTools.evaluate(element => element === document.activeElement), true, 'note dialog Escape did not restore focus to Actions');
    checks.push('note dialog Escape returns focus to the triggering composer control');
    await writeFile(join(evidenceDir, 'dashboard-note-focus.json'), JSON.stringify({onOpen: noteFocus, afterEscape: noteRestored}, null, 2));

    await page.getByRole('button', {name: 'Actions', exact: true}).click();
    await page.getByRole('menuitem', {name: 'Internal note', exact: true}).click();
    await page.getByRole('dialog', {name: 'Add Note'}).getByLabel('Note', {exact: true}).fill('Accessibility audit note, synthetic content.');
    await submitBusyNote(page, evidenceDir);
    checks.push('busy note disables all four controls, retains Tab/Shift+Tab/Escape focus, then persists through the real Worker');
    await page.getByText('Accessibility audit note, synthetic content.', {exact: true}).waitFor();
    await measureContrast(page, 'dashboard-inbox', [
        {label: 'conversation search placeholder', selector: '#chat input[type="search"]', pseudo: '::placeholder'},
        {label: 'conversation timestamp', selector: '#chat time'},
        {label: 'transcript note label', selector: '#chat .transcript-note-label'},
        {label: 'composer reply placeholder', selector: '#chat textarea', pseudo: '::placeholder'},
        {label: 'account initials', selector: '.avatar-title.rounded-circle > span'},
        {label: 'unoccluded Settings navigation label', selector: '[data-testid="nav-settings"] > .navbar-link-label'},
    ]);

    await page.getByRole('button', {name: 'Account menu', exact: true}).click();
    await page.locator('.native-account-dropdown').waitFor();
    assertAxeClean(await scan(page, 'dashboard-account-menu-open'), 'account menu');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.native-account-dropdown') === null);
    assert.equal(await page.getByRole('button', {name: 'Account menu', exact: true}).evaluate(element => element === document.activeElement), true, 'account menu Escape did not restore focus');
    checks.push('account menu closes on Escape and restores trigger focus');

    await page.goto(`${runtime.origin}/projects/${bootstrap.projectId}/edit`);
    await page.getByRole('button', {name: 'Appearance', exact: true}).waitFor();
    assertAxeClean(await scan(page, 'dashboard-project-settings'), 'project settings');
    await measureContrast(page, 'dashboard-project-settings', [
        {label: 'native timezone select value', selector: '#timezone'},
    ]);
    const timezoneChevron = await page.locator('#timezone').evaluate(element => ({
        backgroundImage: getComputedStyle(element).backgroundImage,
        backgroundColor: getComputedStyle(element).backgroundColor,
    }));
    const timezoneChevronColor = svgBackgroundStrokeColor(timezoneChevron.backgroundImage);
    const timezoneChevronContrast = contrastRatio(timezoneChevronColor, timezoneChevron.backgroundColor);
    assert.ok(timezoneChevronContrast >= 3, `native timezone select chevron contrast is below 3:1: ${JSON.stringify({timezoneChevronColor, ...timezoneChevron, timezoneChevronContrast})}`);
    await writeFile(join(evidenceDir, 'dashboard-timezone-chevron-contrast.json'), JSON.stringify({foreground: timezoneChevronColor, background: timezoneChevron.backgroundColor, contrastRatio: timezoneChevronContrast, minimum: 3}, null, 2));
    checks.push(`native timezone select chevron measured ${timezoneChevronContrast}:1 against its field surface`);
    await page.getByRole('button', {name: 'Appearance', exact: true}).click();
    assertAxeClean(await scan(page, 'dashboard-project-appearance'), 'project appearance');
    await keyboardPass(page, 'dashboard-project-settings', {count: 24});
    await checkBrandingFocus(page, evidenceDir);
    checks.push('branding disclosure focus passes composited and rendered-pixel contrast at desktop and 320 pixels; Enter/Space toggle and Tab reaches Logo URL');
    checks.push('project settings General and Appearance tabs are axe scanned');

    for (const route of ['datasets', 'articles', 'categories']) {
        await page.goto(`${runtime.origin}/projects/${bootstrap.projectId}/${route}`);
        await page.waitForTimeout(250);
        const result = await scan(page, `dashboard-knowledge-${route}`);
        assertAxeClean(result, `knowledge ${route}`);
    }
    await checkPopulatedArticle({page, runtime, projectId: bootstrap.projectId, ownerToken: owner.token, call, audit, evidenceDir});
    checks.push('populated article editor passes desktop/mobile Axe, Delete text contrast, layout and keyboard confirmation cancellation');
    checks.push('datasets, article knowledge, and categories routes are axe scanned');

    await page.setViewportSize({width: 320, height: 568});
    await page.goto(inboxUrl);
    await page.getByPlaceholder('Type your reply…').waitFor();
    await page.waitForFunction(() => document.querySelector('.conversation-inbox')?.inert === true);
    const mobileInboxIsolation = await page.locator('.conversation-inbox').evaluate(element => ({ariaHidden: element.getAttribute('aria-hidden'), inert: element.inert}));
    assert.deepEqual(mobileInboxIsolation, {ariaHidden: 'true', inert: true}, 'mobile conversation view left its visually covered inbox list exposed to keyboard or assistive technology');
    checks.push('covered inbox list is inert and hidden from assistive technology while a mobile conversation is open');
    const smallLayout = await measureLayout(page, 'dashboard-320');
    assert.equal(smallLayout.horizontalOverflow, false, '320 CSS-pixel conversation overflows horizontally');
    assert.equal(smallLayout.targetsClipped.length, 0, `320 CSS-pixel dashboard controls remain clipped after scrolling: ${JSON.stringify(smallLayout.targetsClipped)}`);
    assertAxeClean(await scan(page, 'dashboard-mobile-inbox'), 'mobile dashboard inbox');
    await page.setViewportSize({width: 720, height: 500});
    await page.waitForTimeout(250);
    const zoomReflow = await measureLayout(page, 'dashboard-200-percent-zoom-emulation');
    assert.equal(zoomReflow.horizontalOverflow, false, '200% viewport-equivalent reflow overflows horizontally');
    assert.equal(zoomReflow.targetsClipped.length, 0, `200% viewport-equivalent dashboard controls remain clipped after scrolling: ${JSON.stringify(zoomReflow.targetsClipped)}`);
    assert.equal(zoomReflow.interactive.filter(item => !item.centerReachable).length, 0, '200% viewport-equivalent dashboard controls cannot be reached at their center');
    await keyboardPass(page, 'dashboard-200-percent-zoom', {count: 20});
    await page.getByRole('button', {name: 'Toggle navigation', exact: true}).focus();
    const navigationFocus = await measureFocusIndicator(page, {samplePixels: true});
    assert.ok(navigationFocus.ringContrastAgainstHalo >= 3 && navigationFocus.pixelSample.contrastRatio >= 3, 'navigation focus halo must be opaque immediately on focus');
    await writeFile(join(evidenceDir, 'navigation-focus-contrast.json'), JSON.stringify(navigationFocus, null, 2));
    checks.push('320 CSS-pixel reflow and 200% CSS zoom emulation measured');

        return {widgetConfig};
}
