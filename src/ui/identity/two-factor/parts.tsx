import { useState, type ReactNode } from 'react';
import { nativeRequest } from '../../native/transport';
import QrCode from './QrCode';
import { assertPasskey, createPasskey, loopbackAddress, passkeyDomain, passkeysAvailable } from './webauthn-client';
import './two-factor.css';

/** The same two-factor parts render on the public sign-in pages and inside the dashboard, in each one's own controls. */
export type Look = 'identity' | 'dashboard';
const looks = {
    identity: { primary: 'pill pill--ink', secondary: 'tf-text-button', field: 'id-field', input: '', label: '' },
    dashboard: { primary: 'btn btn-primary', secondary: 'btn btn-link px-0', field: 'form-group', input: 'form-control', label: 'form-label' },
};
const post = (path: string, body: unknown) => nativeRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function TextField({ look, id, label, hint, ...input }: { look: Look; id: string; label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
    const style = looks[look];
    return <div className={style.field}><label htmlFor={id} className={style.label}>{label}</label><input id={id} name={id} className={style.input} required aria-describedby={hint ? `${id}-hint` : undefined} {...input} />{hint && <p className={look === 'identity' ? 'id-hint' : 'form-text'} id={`${id}-hint`}>{hint}</p>}</div>;
}
function Problem({ children }: { children: string }) { return children ? <p className="tf-problem" role="alert">{children}</p> : null; }

/** Shown once after the first factor: ten single-use codes to keep somewhere safe. */
export function RecoveryCodes({ codes, look, onDone, doneLabel = 'I have saved these codes' }: { codes: string[]; look: Look; onDone?: () => void; doneLabel?: string }) {
    const [copied, setCopied] = useState(false);
    const text = `HappyToHelp recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n`;
    const download = () => { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); link.download = 'happytohelp-recovery-codes.txt'; link.click(); URL.revokeObjectURL(link.href); };
    return <section className="tf-codes" aria-labelledby="tf-codes-title">
        <h2 id="tf-codes-title">Save your recovery codes</h2>
        <p>If you lose your phone or security key, each code signs you in once. They are shown only now.</p>
        <ol className="tf-code-list">{codes.map(code => <li key={code}><code>{code}</code></li>)}</ol>
        <div className="tf-actions">
            <button type="button" className={looks[look].secondary} onClick={async () => { await navigator.clipboard?.writeText(text); setCopied(true); }}>{copied ? 'Copied' : 'Copy codes'}</button>
            <button type="button" className={looks[look].secondary} onClick={download}>Download .txt</button>
        </div>
        {onDone && <button type="button" className={looks[look].primary} onClick={onDone}>{doneLabel}</button>}
    </section>;
}

/** Scan or type the key into an authenticator app, then confirm with the code it shows. */
export function AuthenticatorSetup({ look, onDone, onCancel }: { look: Look; onDone: (codes: string[] | null) => void; onCancel?: () => void }) {
    const [setup, setSetup] = useState<{ factorId: string; secret: string; uri: string } | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const start = async () => { setBusy(true); setError(''); try { setSetup(await post('/api/identity/two-factor/totp', {})); } catch (failure: any) { setError(failure.message); } setBusy(false); };
    const confirm = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault(); setBusy(true); setError('');
        const form = new FormData(event.currentTarget);
        try { const result = await post('/api/identity/two-factor/totp/confirm', { factorId: setup!.factorId, code: String(form.get('totp-code') || '').replace(/\s/g, ''), label: form.get('totp-label') || undefined }); onDone(result.recoveryCodes); }
        catch (failure: any) { setError(failure.message); setBusy(false); }
    };
    if (!setup) return <div className="tf-step"><Problem>{error}</Problem><button type="button" className={looks[look].primary} disabled={busy} onClick={start}>{busy ? 'Preparing…' : 'Set up an authenticator app'}</button>{onCancel && <button type="button" className={looks[look].secondary} onClick={onCancel}>Cancel</button>}</div>;
    return <form className="tf-step" onSubmit={confirm}>
        <p>Scan this code with an authenticator app such as Google Authenticator, 1Password, Authy or Microsoft Authenticator.</p>
        <div className="tf-setup"><QrCode value={setup.uri} label="QR code for your authenticator app" /><div><p className="tf-key-label">Or enter this key</p><code className="tf-key" data-testid="totp-secret">{setup.secret.match(/.{1,4}/g)!.join(' ')}</code></div></div>
        <TextField look={look} id="totp-label" label="Name (optional)" placeholder="My phone" required={false} maxLength={60} />
        <TextField look={look} id="totp-code" label="Code from the app" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" placeholder="123456" />
        <Problem>{error}</Problem>
        <button className={looks[look].primary} disabled={busy}>{busy ? 'Checking…' : 'Turn on'}</button>
        {onCancel && <button type="button" className={looks[look].secondary} onClick={onCancel}>Cancel</button>}
    </form>;
}

/** Register this device's passkey or a hardware security key. */
export function PasskeySetup({ look, onDone }: { look: Look; onDone: (codes: string[] | null) => void }) {
    const [error, setError] = useState(''), [busy, setBusy] = useState(false);
    if (!passkeysAvailable()) return <p className="tf-muted">This browser cannot use passkeys or security keys.</p>;
    if (!passkeyDomain()) return loopbackAddress()
        ? <p className="tf-muted">Passkeys need a domain name, and this copy runs on {location.hostname}. To move it to localhost and keep your data, run <code>rer dev --stop && rer setup --host localhost && rer dev</code> in your HappyToHelp checkout, then open the RER_OPEN link it prints.</p>
        : <p className="tf-muted">Passkeys need this app’s domain name. Open it by name instead of an IP address.</p>;
    const register = async () => {
        setBusy(true); setError('');
        try { const options = await post('/api/identity/two-factor/webauthn/options', {}); const credential = await createPasskey(options); const result = await post('/api/identity/two-factor/webauthn', { credential, label: 'Passkey' }); onDone(result.recoveryCodes); }
        catch (failure: any) { setError(failure.name === 'NotAllowedError' ? 'The passkey request was cancelled or timed out.' : failure.message); }
        setBusy(false);
    };
    return <div className="tf-step"><p className="tf-muted">A passkey belongs to the address it is made on ({location.hostname}); if you move this app to another address later, add a new one there.</p><Problem>{error}</Problem><button type="button" className={looks[look].primary} disabled={busy} onClick={register}>{busy ? 'Waiting for your device…' : 'Add a passkey or security key'}</button></div>;
}

/**
 * Proves the second factor: a code from the app, a passkey, or a recovery code. With
 * `password`, an account without a factor confirms its password instead (a step-up).
 */
export function FactorProof({ look, endpoint, passkey = true, password = false, submitLabel = 'Verify', onDone, extra }: { look: Look; endpoint: string; passkey?: boolean; password?: boolean; submitLabel?: string; onDone: (result: any) => void; extra?: ReactNode }) {
    const [mode, setMode] = useState<'code' | 'recovery'>('code'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const send = async (body: unknown) => { setBusy(true); setError(''); try { onDone(await post(endpoint, body)); } catch (failure: any) { setError(failure.message); setBusy(false); } };
    const submit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (password) return send({ password: form.get('step-up-password') });
        return send(mode === 'code' ? { code: String(form.get('factor-code') || '').replace(/\s/g, '') } : { recoveryCode: form.get('recovery-code') });
    };
    const withPasskey = async () => {
        setBusy(true); setError('');
        try { const options = await post('/api/identity/two-factor/assertion-options', {}); onDone(await post(endpoint, { credential: await assertPasskey(options) })); }
        catch (failure: any) { setError(failure.name === 'NotAllowedError' ? 'The passkey request was cancelled or timed out.' : failure.message); setBusy(false); }
    };
    const style = looks[look];
    if (password) return <form className="tf-step" onSubmit={submit}><TextField look={look} id="step-up-password" label="Your password" type="password" autoComplete="current-password" /><Problem>{error}</Problem><button className={style.primary} disabled={busy}>{busy ? 'Checking…' : submitLabel}</button>{extra}</form>;
    return <form className="tf-step" onSubmit={submit}>
        {mode === 'code'
            ? <TextField look={look} id="factor-code" label="Code from your authenticator app" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" placeholder="123456" autoFocus />
            : <TextField look={look} id="recovery-code" label="Recovery code" autoComplete="off" placeholder="abcde-12345" />}
        <Problem>{error}</Problem>
        <button className={style.primary} disabled={busy}>{busy ? 'Checking…' : submitLabel}</button>
        <div className="tf-alternatives">
            {passkey && passkeysAvailable() && passkeyDomain() && <button type="button" className={style.secondary} disabled={busy} onClick={withPasskey}>Use a passkey or security key</button>}
            <button type="button" className={style.secondary} onClick={() => { setMode(mode === 'code' ? 'recovery' : 'code'); setError(''); }}>{mode === 'code' ? 'Use a recovery code' : 'Use a code from the app'}</button>
        </div>
        {extra}
    </form>;
}
