import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';

// Default deployment: registration off and no email provider. Covers the fresh install, the plain link-problem pages,
// the invitation page for a signed-out invitee and every kind of person who can follow an invitation link.
const invitedPassword=randomBytes(24).toString('base64url');
const owner = { name: 'Harbour Desk', email: 'aster@review.test', password: randomBytes(24).toString('base64url') };

export async function checkFreshInstall({ origin, kit }) {
    let page = await kit.open(origin, '/login');
    const setup = page.getByRole('link', { name: /set up your workspace/i });
    await setup.waitFor();
    assert.equal(await setup.getAttribute('href'), '/setup');
    assert.equal(await page.locator('a[href="/register"]').count(), 0, 'no Sign up link while registration is off');
    assert.ok((await kit.hrefs(page)).includes('/forgot-password'));
    await kit.done(page, 'login-fresh-install');
    kit.pass('fresh install: /login points to /setup and offers no sign-up');

    page = await kit.open(origin, '/register');
    await page.getByRole('heading', { name: 'Sign-up is closed' }).waitFor();
    assert.equal(await page.locator('input').count(), 0, 'no form when registration is closed');
    assert.deepEqual((await kit.hrefs(page)).filter(href => ['/login', '/setup', '/'].includes(href)).sort(), ['/', '/', '/login', '/setup']);
    await kit.done(page, 'register-closed');
    kit.pass('registration disabled: /register shows a closed notice with links to /login and /setup, and no form');

}

export async function checkForgotPasswordWithoutEmail({ origin, kit }) {
    const page = await kit.open(origin, '/forgot-password');
    assert.match(await kit.text(page), /workspace owner must reset your password/, 'said before submitting');
    await page.getByLabel('Email address').fill('nobody@review.test');
    const answered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/identity/forgot-password');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    assert.equal((await answered).status(), 503, 'still fails closed');
    await page.getByRole('alert').filter({ hasText: /workspace owner must reset your password/ }).waitFor();
    await kit.expectNoText(page, /on its way|has been sent/);
    await kit.done(page, 'forgot-password-no-email');
    kit.pass('forgot-password without email: fails closed (503), says the workspace owner must reset it, claims no link was sent');
}

export async function createOwner({ origin, kit }) {
    const created = await kit.api(origin, '/api/identity/bootstrap', { body: { name: owner.name, ownerName: 'Aster Owner', email: owner.email, password: owner.password, allowedOrigin: 'https://harbour.example' } });
    assert.equal(created.status, 201, created.text);
    return { ...owner, projectId: created.json.projectId, token: created.json.token };
}

export async function checkAfterSetup({ origin, kit }) {
    let page = await kit.open(origin, '/setup');
    const signIn = page.getByRole('link', { name: 'Sign in', exact: true });
    await signIn.waitFor();
    assert.equal(await signIn.getAttribute('href'), '/login?returnTo=%2Fsetup', 'sign-in resumes the setup page');
    assert.equal(await page.getByRole('button', { name: 'Create workspace' }).count(), 0);
    await kit.done(page, 'setup-complete');
    kit.pass('/setup once complete: a Sign in link, no wizard');
    page = await kit.open(origin, '/login');
    await kit.expectNoText(page, /not been set up/);
    await kit.done(page);
    kit.pass('after setup /login no longer points to /setup');
}

export async function checkLinkProblems({ origin, kit }) {
    const cases = [
        ['/verify-email', /link is incomplete/, ['/login', '/register'], 'verify-email without a token'],
        ['/verify-email?token=bogus-token', /invalid or has expired/, ['/login', '/register'], 'verify-email with an unknown token'],
        ['/reset-password', /link is incomplete/, ['/forgot-password', '/login'], 'reset-password without a token'],
        ['/reset-password?token=bogus-token', /invalid or has expired/, ['/forgot-password', '/login'], 'reset-password with an unknown token'],
        ['/accept-invitation', /link is incomplete/, ['/login'], 'accept-invitation without a token'],
        ['/accept-invitation?token=bogus-token', /invalid or has expired/, ['/login'], 'accept-invitation with an unknown token'],
    ];
    for (const [path, message, links, label] of cases) {
        const page = await kit.open(origin, path);
        await kit.expectText(page, message);
        assert.equal(await page.locator('input').count(), 0, `${label}: no form`);
        const hrefs = await kit.hrefs(page);
        for (const href of [...links, '/']) assert.ok(hrefs.includes(href), `${label}: links to ${href} (${hrefs})`);
        assert.ok(!page.requests.some(request => request.startsWith('POST /api/identity/verify-email') || request.startsWith('POST /api/identity/accept-token')), `${label}: nothing was submitted`);
        await kit.expectNoText(page, /Authentication required/);
        await kit.done(page, label.replace(/\W+/g, '-'));
    }
    kit.pass('verify-email, reset-password and accept-invitation report a missing or unknown link on load, with no form and ways to recover (without consuming a link)');
}

export async function checkInvitationAcceptance({ origin, kit, runtime }, ownerSession) {
    const invite = async (email, session = ownerSession) => (await kit.api(origin, `/api/management/projects/${session.projectId}/agents`, { body: { email, role: 'operator' }, token: session.token })).json.data;
    const link = invitation => { const url = new URL(invitation.invitationUrl); return url.pathname + url.search; };

    // A new person, signed out.
    const nia = await invite('nia@review.test');
    assert.equal(nia.delivery, 'not_configured');
    let page = await kit.open(origin, link(nia));
    await kit.expectText(page, /Join Harbour Desk/);
    const text = await kit.text(page);
    assert.match(text, /nia@review\.test/);
    assert.doesNotMatch(text, /Authentication required/);
    assert.ok((await page.locator('a', { hasText: 'Sign in' }).getAttribute('href')).includes('returnTo='), 'sign-in link returns to the invitation');
    await kit.assertNewPasswordField(page, 'accept-invitation');
    await page.getByLabel('Your name').fill('Nia Newhire');
    await kit.assertShortPasswordBlocked(page, () => page.getByRole('button', { name: 'Create account and join' }).click(), 'accept-invitation');
    await kit.done(page, 'accept-invitation-new-person');
    page = await kit.open(origin, link(nia));
    await page.getByLabel('Your name').fill('Nia Newhire');
    await page.locator('input[type=password]').fill(invitedPassword);
    await page.getByRole('button', { name: 'Create account and join' }).click();
    await kit.expectText(page, /Welcome to Harbour Desk/);
    assert.equal(await page.getByRole('alert').count(), 0);
    await kit.done(page, 'accept-invitation-created');
    kit.pass('signed-out new invitee: sees workspace and email on load, short password stopped in the browser, valid account created without an error');

    page = await kit.open(origin, '/login?returnTo=' + encodeURIComponent(`/projects/${ownerSession.projectId}/conversations`));
    await kit.login(page, 'nia@review.test', invitedPassword);
    await page.waitForURL('**/conversations');
    const session = await page.evaluate(async () => (await fetch('/api/identity/session')).json());
    assert.equal(session.projectId, ownerSession.projectId);
    assert.equal(session.role, 'operator');
    await kit.done(page);
    kit.pass('the new person signs in and lands in the inviting workspace as an operator');

    page = await kit.open(origin, link(nia));
    await kit.expectText(page, /already been used/);
    assert.equal(await page.locator('input').count(), 0);
    assert.ok((await kit.hrefs(page)).includes('/login'));
    await kit.done(page, 'accept-invitation-used');
    kit.pass('a used invitation link says so, offers sign in and shows no form');

    const late = await invite('late@review.test');
    await runtime.execute("UPDATE identity_tokens SET expires_at=1 WHERE lower(email)='late@review.test'");
    const listed = (await kit.api(origin, `/api/management/projects/${ownerSession.projectId}/agents`, { token: ownerSession.token })).json;
    assert.ok(!listed.data.some(row => row.email === 'late@review.test'), 'an expired invitation is not listed as pending');

    // Someone who already has an account, invited to a second workspace.
    const created = await kit.api(origin, '/api/management/projects', { body: { name: 'Second Desk', allowedOrigin: origin }, token: ownerSession.token });
    assert.equal(created.status, 201, created.text);
    const switched = await kit.api(origin, '/api/identity/switch-project', { body: { projectId: created.json.id }, token: ownerSession.token });
    const secondOwner = { projectId: created.json.id, token: switched.json.token };
    const returning = await invite('nia@review.test', secondOwner);
    page = await kit.open(origin, link(returning));
    await kit.expectText(page, /Sign in to join Second Desk/);
    assert.match(await kit.text(page), /nia@review\.test/);
    assert.equal(await page.getByLabel('Your name').count(), 0, 'an account holder is not asked for a name');
    await kit.shot(page, 'accept-invitation-account-holder');
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/login?returnTo=*');
    await kit.login(page, 'nia@review.test', invitedPassword);
    await page.waitForURL('**/accept-invitation?token=*');
    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await kit.expectText(page, /You have joined Second Desk/);
    await kit.done(page, 'accept-invitation-joined');
    const members = (await kit.api(origin, `/api/management/projects/${secondOwner.projectId}/agents`, { token: secondOwner.token })).json.data;
    assert.equal(members.find(member => member.email === 'nia@review.test')?.role, 'operator');
    assert.ok(!members.some(member => member.pending), 'accepted invitation is no longer pending');
    kit.pass('signed-out account holder signs in from the link, comes back to it, accepts, and becomes an operator member');

    // Signed in as somebody else.
    const zed = await invite('zed@review.test');
    page = await kit.open(origin, link(zed), { token: ownerSession.token });
    await kit.expectText(page, /This invitation is for another account/);
    assert.match(await kit.text(page), /zed@review\.test[\s\S]*aster@review\.test/);
    await kit.done(page, 'accept-invitation-other-account');
    kit.pass('signed in as a different account: the page names the invited email and says it is for another account');

    page = await kit.open(origin, link(late));
    await kit.expectText(page, /has expired/);
    assert.equal(await page.locator('input').count(), 0);
    await kit.done(page, 'accept-invitation-expired');
    kit.pass('an expired invitation is reported as expired, with no form');
    return { operator: { email: 'nia@review.test', password: invitedPassword } };
}
