import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { passwordHash, sqlQuote } from './identity-browser-kit.mjs';
import { totp } from './identity/two-factor.mjs';

// Deployment with sign-up on and an email provider configured. No test submits a form that would send mail:
// sign-up is checked up to its browser validation, forgot-password uses an address that has no account.
// Invitations come from the management door, whose mail is answered by the provider fixture.
// Sign-up does not take the place of setup: until the first owner exists, /register is closed even though sign-up is on.
export async function checkRegistrationBeforeSetup({ origin, kit }) {
    const page = await kit.open(origin, '/register');
    await page.getByRole('heading', { name: 'Sign-up is closed' }).waitFor();
    assert.equal(await page.locator('input').count(), 0);
    assert.ok((await kit.hrefs(page)).includes('/setup'));
    await kit.expectText(page, /first owner account is created in setup/);
    await kit.done(page, 'register-before-setup');
    const refused = await kit.api(origin, '/api/identity/register', { body: { name: 'Early', email: 'early@review.test', password: 'early-secret-pass-1', projectName: 'Early', allowedOrigin: 'https://early.example' } });
    assert.equal(refused.status, 503, refused.text);
    kit.pass('sign-up on but no owner yet: /register is closed and points to /setup, and the API refuses before sending anything');
}

export async function checkRegistrationOpen({ origin, kit }) {
    let page = await kit.open(origin, '/login');
    await page.locator('a[href="/register"]').waitFor();
    assert.equal(await page.locator('a[href="/setup"]').count(), 0);
    await kit.done(page);
    page = await kit.open(origin, '/register');
    for (const name of ['name', 'email', 'password', 'projectName', 'allowedOrigin']) await page.locator(`input[name="${name}"]`).waitFor();
    assert.ok((await kit.hrefs(page)).includes('/login'));
    await kit.assertNewPasswordField(page, 'register');
    await page.getByLabel('Your name').fill('Rae Registrant');
    await page.getByLabel('Email address').fill('rae@review.test');
    await page.getByLabel('Workspace name').fill('Rae Works');
    await page.getByLabel('Widget website origin').fill('https://rae.example');
    await kit.assertShortPasswordBlocked(page, () => page.getByRole('button', { name: 'Create account' }).click(), 'register');
    await kit.done(page, 'register-form');
    kit.pass('registration on: /login links to /register, which shows the form and refuses a short password before sending');
}

export async function checkForgotPasswordWithEmail({ origin, kit }) {
    const page = await kit.open(origin, '/forgot-password');
    await kit.expectNoText(page, /workspace owner must reset/);
    await page.getByLabel('Email address').fill('nobody@review.test');
    const answered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/identity/forgot-password');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    assert.equal((await answered).status(), 200);
    await kit.expectText(page, /If an account exists for that address/);
    await kit.done(page, 'forgot-password-sent');
    kit.pass('forgot-password with email configured: neutral confirmation for an address that has no account');
}

export async function checkResetPassword({ origin, kit }, owner) {
    const invitation = await kit.api(origin, `/api/management/projects/${owner.projectId}/agents`, { body: { email: 'kim@review.test' }, token: owner.token });
    await kit.api(origin, '/api/identity/accept-token', { body: { token: new URL(invitation.json.data.invitationUrl).searchParams.get('token'), name: 'Kim', password: 'synthetic-kim-first-password-1' } });
    const kim = await kit.api(origin, '/api/identity/login', { body: { email: 'kim@review.test', password: 'synthetic-kim-first-password-1' } });
    // An owner issues a teammate's reset link with their own second factor.
    const setup = await kit.api(origin, '/api/identity/two-factor/totp', { body: {}, token: owner.token });
    assert.equal((await kit.api(origin, '/api/identity/two-factor/totp/confirm', { body: { factorId: setup.json.factorId, code: totp(setup.json.secret) }, token: owner.token })).status, 201);
    const reset = await kit.api(origin, '/api/identity/password-reset', { body: { userId: kim.json.actor.id }, token: owner.token });
    assert.equal(reset.status, 201, reset.text);
    const page = await kit.open(origin, '/reset-password?token=' + reset.json.token);
    await kit.expectText(page, /kim@review\.test/);
    await kit.assertNewPasswordField(page, 'reset-password');
    await kit.assertShortPasswordBlocked(page, () => page.getByRole('button', { name: 'Set new password' }).click(), 'reset-password');
    await kit.shot(page, 'reset-password-form');
    await page.locator('input[type=password]').fill('synthetic-kim-second-password-2');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await kit.expectText(page, /Password updated/);
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal((await kit.api(origin, '/api/identity/login', { body: { email: 'kim@review.test', password: 'synthetic-kim-second-password-2' } })).status, 200);
    assert.equal((await kit.api(origin, '/api/identity/login', { body: { email: 'kim@review.test', password: 'synthetic-kim-first-password-1' } })).status, 401);
    await kit.done(page, 'reset-password-done');
    kit.pass('reset-password: names the account, enforces the rule in the browser, sets the new password and retires the old');
}

export async function checkVerifyEmail({ origin, kit, runtime }) {
    const register = async (token, email, workspace, expires) => runtime.execute(`INSERT INTO registrations VALUES(${[createHash('sha256').update(token).digest('hex'), email, 'Verity Owner', passwordHash('verity-secret-pass-1'), workspace, 'https://verity.example', expires].map(sqlQuote).join(',')},NULL)`);
    await register('verify-live-token', 'verity@review.test', 'Verity Works', Date.now() + 3600000);
    await register('verify-old-token', 'old@review.test', 'Old Works', 1);
    let page = await kit.open(origin, '/verify-email?token=verify-live-token');
    await kit.expectText(page, /Confirm your email/);
    const text = await kit.text(page);
    assert.match(text, /verity@review\.test/);
    assert.match(text, /Verity Works/);
    assert.ok(!page.requests.includes('POST /api/identity/verify-email'), 'opening the link consumes nothing');
    await kit.shot(page, 'verify-email-ready');
    await page.getByRole('button', { name: 'Confirm email' }).click();
    await kit.expectText(page, /Email confirmed/);
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.ok((await kit.hrefs(page)).includes('/login'));
    await kit.done(page, 'verify-email-done');
    const session = await kit.api(origin, '/api/identity/login', { body: { email: 'verity@review.test', password: 'verity-secret-pass-1' } });
    assert.equal(session.json.actor.role, 'owner');
    kit.pass('verify-email: validated up front (names email and workspace), completes on one explicit action, new owner can sign in');
    page = await kit.open(origin, '/verify-email?token=verify-live-token');
    await kit.expectText(page, /already been used/);
    assert.ok((await kit.hrefs(page)).includes('/login') && (await kit.hrefs(page)).includes('/register'));
    await kit.done(page, 'verify-email-used');
    page = await kit.open(origin, '/verify-email?token=verify-old-token');
    await kit.expectText(page, /has expired/);
    await kit.done(page);
    kit.pass('verify-email: a used link says so and an old one says it expired, each with sign-in and sign-up links');
}
