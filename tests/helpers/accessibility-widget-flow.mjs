import assert from 'node:assert/strict';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {measureFocusIndicator} from './accessibility-focus-contrast.mjs';

export async function runWidgetAccessibility({browser, runtime, hostOrigin, widgetConfig, axePath, audit, checks, errors, failedResponses, evidenceDir}) {
    const {scan, assertAxeClean, keyboardPass, measureLayout, measureContrast} = audit;
    const widgetPage = await browser.newPage({viewport: {width: 1440, height: 960}});
    widgetPage.on('pageerror', error => errors.push(error.message));
    widgetPage.on('response', response => { if (response.status() >= 400) failedResponses.push({status: response.status(), path: new URL(response.url()).pathname}); });
    await widgetPage.addScriptTag({path: axePath});
    await widgetPage.goto(hostOrigin);
    await widgetPage.waitForFunction(() => typeof window.h2h === 'function');
    const gated = await widgetPage.evaluate(() => ({rootCount: document.querySelector('#happytohelp > div')?.shadowRoot?.querySelectorAll('#happytohelp-root').length || 0, iframeCount: document.querySelectorAll('iframe').length}));
    assert.equal(gated.rootCount, 0, 'widget mounted before host consent');
    checks.push('host-controlled consent withholds widget UI before grant');
    await widgetPage.evaluate(() => window.h2h('consent', {provided: true}));
    await widgetPage.getByRole('button', {name: 'Open chat', exact: true}).waitFor();
    assertAxeClean(await scan(widgetPage, 'widget-consent-granted-closed', {shadow: true}), 'widget closed after consent');
    await keyboardPass(widgetPage, 'widget-closed', {count: 4, shadow: true});
    await widgetPage.evaluate(() => window.h2h('open'));
    await widgetPage.getByRole('button', {name: 'Close chat', exact: true}).waitFor();
    await widgetPage.locator('textarea[aria-label]').waitFor();
    const responderToggle = widgetPage.locator('.happytohelp-chat-header[role="button"]');
    if (await responderToggle.count()) {
        await responderToggle.focus();
        await widgetPage.keyboard.press('Enter');
        await widgetPage.waitForFunction(() => document.querySelector('#happytohelp > div')?.shadowRoot?.querySelector('.happytohelp-chat-header-container-expanded') !== null);
        assert.equal(await responderToggle.getAttribute('aria-expanded'), 'true', 'widget responder picker did not open with Enter');
        await widgetPage.keyboard.press('Escape');
        await widgetPage.waitForFunction(() => document.querySelector('#happytohelp > div')?.shadowRoot?.querySelector('.happytohelp-chat-header-container-expanded') === null);
        assert.equal(await responderToggle.evaluate(element => element === element.getRootNode().activeElement), true, 'widget responder picker Escape did not restore focus');
        checks.push('widget responder picker opens with Enter, closes with Escape, and restores focus');
    } else {
        const staticResponder = widgetPage.locator('.happytohelp-chat-header.happytohelp-chat-no-action');
        await staticResponder.waitFor();
        assert.match(await staticResponder.innerText(), /Human/, 'single-responder widget header does not identify the current human responder');
        assert.equal(await staticResponder.getAttribute('tabindex'), null, 'static single-responder label is incorrectly exposed as a keyboard action');
        checks.push('single-responder widget exposes a named static current responder; no picker control exists in this local project configuration');
    }
    assertAxeClean(await scan(widgetPage, 'widget-open-composer', {shadow: true}), 'widget open composer');
    await keyboardPass(widgetPage, 'widget-open', {count: 20, shadow: true});
    await widgetPage.getByRole('button', {name: 'Send message', exact: true}).focus();
    const sendFocus = await measureFocusIndicator(widgetPage, {shadow: true, samplePixels: true});
    assert.ok(sendFocus.ringContrastAgainstHalo >= 3 && sendFocus.pixelSample.contrastRatio >= 3, 'send focus must contrast against the surface outside its button');
    await writeFile(join(evidenceDir, 'widget-send-focus-contrast.json'), JSON.stringify(sendFocus, null, 2));
    const widgetDesktop = await measureLayout(widgetPage, 'widget-desktop', {shadow: true});
    await measureContrast(widgetPage, 'widget-open-composer', [
        {label: 'human response estimate', selector: '.happytohelp-insight-agent-info'},
        {label: 'email notification explanation', selector: '.happytohelp-collect-notify-email'},
        {label: 'name placeholder', selector: '.happytohelp-collect-customer input[name="name"]', pseudo: '::placeholder'},
        {label: 'email placeholder', selector: '.happytohelp-collect-customer input[name="email"]', pseudo: '::placeholder'},
        {label: 'message placeholder', selector: '.happytohelp-interact textarea', pseudo: '::placeholder'},
        {label: 'responder avatar initials', selector: '.happytohelp-agent-avatar.happytohelp-agent-avatar-initials > span'},
        {label: 'attachment icon', selector: '.happytohelp-send-message-row-buttons button[name="attach"] svg', minimum: 3},
        {label: 'screenshot icon', selector: '.happytohelp-send-message-row-buttons button[name="screenshot"] svg', minimum: 3, optional: true},
    ], {shadow: true});
    const screenshotAction = widgetPage.locator('.happytohelp-send-message-row-buttons button[name="screenshot"]');
    const attachmentAction = widgetPage.locator('.happytohelp-send-message-row-buttons button[name="attach"]');
    await screenshotAction.hover();
    await measureContrast(widgetPage, 'widget-fullscreen-icon-hover', [
        {label: 'hovered fullscreen icon', selector: '.happytohelp-send-message-row-buttons button[name="screenshot"] svg', minimum: 3},
    ], {shadow: true});
    await attachmentAction.hover();
    await measureContrast(widgetPage, 'widget-attachment-icon-hover', [
        {label: 'hovered attachment icon', selector: '.happytohelp-send-message-row-buttons button[name="attach"] svg', minimum: 3},
    ], {shadow: true});
    await screenshotAction.focus();
    await widgetPage.keyboard.press('Tab');
    assert.equal(await attachmentAction.evaluate(element => element === element.getRootNode().activeElement), true, 'keyboard focus did not move from fullscreen to attachment');
    const attachmentFocus = await attachmentAction.evaluate(element => {
        const style = getComputedStyle(element);
        return {outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor};
    });
    assert.ok(attachmentFocus.outlineStyle !== 'none' && Number.parseFloat(attachmentFocus.outlineWidth) >= 2, `attachment action lacks a visible focus ring: ${JSON.stringify(attachmentFocus)}`);
    await measureContrast(widgetPage, 'widget-attachment-icon-focus', [
        {label: 'focused attachment icon', selector: '.happytohelp-send-message-row-buttons button[name="attach"] svg', minimum: 3},
    ], {shadow: true});
    checks.push('real widget opened through its local emitted Worker and exposes named composer and actions');

    await widgetPage.locator('button[name="submit"]').click();
    const widgetErrors = widgetPage.locator('[role="alert"].happytohelp-error');
    await widgetErrors.first().waitFor();
    const errorCount = await widgetErrors.count();
    assert.ok(errorCount >= 1, 'widget send did not announce validation errors');
    assertAxeClean(await scan(widgetPage, 'widget-error-open', {shadow: true}), 'widget error');
    await widgetErrors.first().getByRole('button', {name: 'Dismiss message', exact: true}).focus();
    await widgetPage.keyboard.press('Enter');
    await widgetPage.waitForFunction(previousCount => document.querySelectorAll('#happytohelp > div').item(0)?.shadowRoot?.querySelectorAll('[role="alert"].happytohelp-error').length === previousCount - 1, errorCount);
    checks.push(`widget validation displays ${errorCount} alert(s); dismissal works by keyboard`);

    const fileInput = widgetPage.locator('input[type="file"][aria-label]');
    const imageBytes = await widgetPage.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 100;
        const context = canvas.getContext('2d');
        context.fillStyle = '#5232a8';
        context.fillRect(0, 0, 2, 2);
        const blob = await new Promise(resolveBlob => canvas.toBlob(resolveBlob, 'image/png'));
        return [...new Uint8Array(await blob.arrayBuffer())];
    });
    await fileInput.setInputFiles({name: 'accessibility.png', mimeType: 'image/png', buffer: Buffer.from(imageBytes)});
    const previewTrigger = widgetPage.getByRole('button', {name: 'Preview image', exact: true});
    await previewTrigger.waitFor();
    assertAxeClean(await scan(widgetPage, 'widget-attachment-composer', {shadow: true}), 'widget attachment composer');
    await previewTrigger.focus();
    await previewTrigger.press('Enter', {timeout: 5000});
    const previewDebug = await widgetPage.evaluate(() => {
        const root = document.querySelector('#happytohelp > div')?.shadowRoot;
        return {
            active: root?.activeElement?.outerHTML?.slice(0, 300),
            trigger: root?.querySelector('.happytohelp-preview-trigger')?.outerHTML?.slice(0, 500),
            modal: root?.querySelector('#happytohelp-modal-preview')?.outerHTML?.slice(0, 500),
            targetFound: Boolean(root?.querySelector('#happytohelp-root')),
        };
    });
    await writeFile(join(evidenceDir, 'widget-preview-open-debug.json'), JSON.stringify(previewDebug, null, 2));
    const previewDialog = widgetPage.getByRole('dialog', {name: 'Preview accessibility.png'});
    await previewDialog.waitFor({timeout: 5000});
    const previewIsolation = await widgetPage.evaluate(() => {
        const root = document.querySelector('#happytohelp > div')?.shadowRoot;
        const background = root?.querySelector('#happytohelp-root');
        return {ariaHidden: background?.getAttribute('aria-hidden'), inert: background?.inert};
    });
    assert.deepEqual(previewIsolation, {ariaHidden: 'true', inert: true}, 'preview dialog did not remove the obscured widget from keyboard interaction');
    assertAxeClean(await scan(widgetPage, 'widget-attachment-preview', {shadow: true}), 'widget attachment preview dialog');
    const previewOpenFocus = await widgetPage.evaluate(() => {
        const root = document.querySelector('#happytohelp > div')?.shadowRoot;
        return root?.activeElement?.getAttribute('aria-label');
    });
    await widgetPage.keyboard.press('Tab');
    const previewTabFocus = await widgetPage.evaluate(() => {
        const root = document.querySelector('#happytohelp > div')?.shadowRoot;
        return root?.activeElement?.getAttribute('aria-label');
    });
    await widgetPage.keyboard.press('Escape');
    await previewDialog.waitFor({state: 'detached'});
    const previewRestoredFocus = await widgetPage.evaluate(() => {
        const root = document.querySelector('#happytohelp > div')?.shadowRoot;
        return root?.activeElement?.getAttribute('aria-label');
    });
    assert.equal(previewOpenFocus, 'Close preview');
    assert.equal(previewTabFocus, 'Close preview', 'preview dialog Tab escaped its focus boundary');
    assert.equal(previewRestoredFocus, 'Preview image', 'preview Escape did not restore focus to its trigger');
    const previewAfterClose = await widgetPage.evaluate(() => {
        const root = document.querySelector('#happytohelp > div')?.shadowRoot;
        const background = root?.querySelector('#happytohelp-root');
        return {ariaHidden: background?.getAttribute('aria-hidden'), inert: background?.inert};
    });
    assert.deepEqual(previewAfterClose, {ariaHidden: null, inert: false}, 'closing preview did not restore the widget interaction state');
    checks.push('attachment preview dialog traps Tab, closes on Escape, and restores focus');

    await fileInput.setInputFiles({name: 'accessibility-context.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic non-image accessibility attachment.')});
    // Dropzone retains a relative path for untransformed files (images are resized).
    const documentLink = widgetPage.getByRole('link', {name: /(?:^|\/)accessibility-context\.txt$/});
    await documentLink.waitFor();
    const documentHref = await documentLink.getAttribute('href');
    assert.match(documentHref, /^blob:/, 'non-image composer attachment should expose its real local blob link');
    await documentLink.focus();
    const popupEvent = widgetPage.waitForEvent('popup');
    await widgetPage.keyboard.press('Enter');
    const documentPage = await popupEvent;
    try {
        await documentPage.waitForLoadState();
        assert.equal(documentPage.url(), documentHref);
        assert.match(await documentPage.locator('body').innerText(), /Synthetic non-image accessibility attachment/);
        await writeFile(join(evidenceDir, 'widget-nonimage-keyboard.json'), JSON.stringify({activation: 'Enter', hrefScheme: 'blob:', target: await documentLink.getAttribute('target'), openedMatchingUrl: true, contentVerified: true, previewDialogCount: await widgetPage.getByRole('dialog').count()}, null, 2));
    } finally {
        await documentPage.close();
    }
    checks.push('non-image attachment opens its real blob link in a new tab with Enter; no iframe preview UI is claimed');

    await widgetPage.setViewportSize({width: 320, height: 568});
    await widgetPage.waitForFunction(() => {
        const host = document.querySelector('#happytohelp > div');
        const root = host?.shadowRoot;
        const panel = root?.querySelector('.happytohelp-interact-container');
        if (!panel) return false;
        const viewportWidthUnit = Number.parseFloat(getComputedStyle(host).getPropertyValue('--vw'));
        const rect = panel.getBoundingClientRect();
        const style = getComputedStyle(panel);
        return viewportWidthUnit >= 3.1 && viewportWidthUnit <= 3.3
            && style.display !== 'none' && style.visibility !== 'hidden'
            && rect.width <= innerWidth + 1 && rect.right <= innerWidth + 1;
    }, undefined, {timeout: 10000});
    await widgetPage.waitForTimeout(400);
    const widgetMobile = await measureLayout(widgetPage, 'widget-320', {shadow: true});
    assert.ok(widgetMobile.panel && widgetMobile.panel.width > 0 && widgetMobile.panel.height > 0, 'mobile widget panel is not visible after responsive layout settles');
    assert.ok(widgetMobile.panel.right <= 321, 'mobile widget panel overflows the viewport');
    assert.equal(widgetMobile.surfaceHorizontalOverflow, false, `mobile widget surface has horizontal overflow: ${JSON.stringify(widgetMobile.surface)}`);
    assert.equal(widgetMobile.targetsClipped.length, 0, `mobile widget controls are clipped: ${JSON.stringify(widgetMobile.targetsClipped)}`);
    assert.equal(widgetMobile.interactive.filter(item => !item.centerReachable).length, 0, `mobile widget controls cannot be reached at their center: ${JSON.stringify(widgetMobile.interactive.filter(item => !item.centerReachable))}`);
    assertAxeClean(await scan(widgetPage, 'widget-mobile-open', {shadow: true}), 'mobile widget');

    await widgetPage.evaluate(() => window.h2h('consent', {provided: false}));
    await widgetPage.waitForFunction(() => !document.querySelector('#happytohelp > div')?.shadowRoot?.querySelector('#happytohelp-root'));
    checks.push('host consent revocation unmounts the widget');

        return {widgetPage};
}
