import { useEffect, useState } from 'react';
import IdentityFrame from './IdentityFrame';
import { Alert } from './fields';
import { nativeRequest } from '../native/transport';
import { signInDestination } from './sign-in-destination';
import { AuthenticatorSetup, FactorProof, PasskeySetup, RecoveryCodes } from './two-factor/parts';
import StepUpHost from '../native/StepUpDialog';

interface Status { factors: { id: string; kind: 'totp' | 'webauthn'; label: string }[]; pending: 'verify' | 'enrol' | null; required: boolean }
const destination = () => signInDestination(new URLSearchParams(location.search).get('returnTo'), location.origin);

/** The second step of signing in: prove the second factor, or set one up when the workspace requires it. */
export default function TwoFactor() {
    const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState(''), [codes, setCodes] = useState<string[] | null>(null);
    const proceed = async () => location.assign(await destination());
    useEffect(() => {
        nativeRequest('/api/identity/two-factor').then((value: Status) => { if (!value.pending) return proceed(); setStatus(value); })
            .catch((failure: any) => { if (failure.status === 401) location.assign('/login'); else setError(failure.message); });
    }, []);
    const signOut = async () => { try { await nativeRequest('/auth/signout', { method: 'POST' }); location.assign('/login'); } catch (failure: any) { setError(failure.message); } };
    const away = <div className="id-links"><button type="button" className="tf-text-button" onClick={signOut}>Sign out</button><a href="/owner-recovery">Owner lost every factor?</a></div>;
    if (codes) return <IdentityFrame><RecoveryCodes codes={codes} look="identity" onDone={proceed} doneLabel="I have saved them. Continue" /></IdentityFrame>;
    if (!status) return <IdentityFrame><h1>Two-step sign-in</h1><Alert>{error}</Alert>{!error && <p className="id-lede">Checking your account…</p>}</IdentityFrame>;
    if (status.pending === 'verify') return <IdentityFrame>
        <h1>Check it’s you</h1>
        <p className="id-lede">Enter the code from your authenticator app, use your passkey, or use a recovery code.</p>
        <FactorProof look="identity" endpoint="/api/identity/two-factor/verify" passkey={status.factors.some(factor => factor.kind === 'webauthn')} submitLabel="Continue" onDone={proceed} />
        <Alert>{error}</Alert>{away}
    </IdentityFrame>;
    return <IdentityFrame wide>
        <h1>Turn on two-factor sign-in</h1>
        <p className="id-lede">Your workspace requires a second step when you sign in. Set one up now to continue.</p>
        <div className="tf-choices">
            <section><h2>Authenticator app</h2><AuthenticatorSetup look="identity" onDone={result => result ? setCodes(result) : proceed()} /></section>
            <section><h2>Passkey or security key</h2><PasskeySetup look="identity" onDone={result => result ? setCodes(result) : proceed()} /></section>
        </div>
        <Alert>{error}</Alert>{away}
        {/* Setting up a factor asks for the password again when the sign-in is over 15 minutes old. */}
        <StepUpHost />
    </IdentityFrame>;
}
