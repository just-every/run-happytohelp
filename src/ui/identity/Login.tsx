import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from '@tanstack/react-router';
import { normalizeEmail } from '@runeditrun/rer/internal/modules/operator-auth/policy.mjs';
import { loginDestination } from '../native/dashboard-path';
import IdentityFrame from './IdentityFrame';
import SignInDrawing from './SignInDrawing';
import { Alert, Field, SubmitButton } from './fields';
import { postJson, useAuthOptions, useSignInMail } from './hooks';
import { signInDestination } from './sign-in-destination';

// HTTP redirects inherit a document fragment that the server never receives.
// Carry that fragment into the same validated destination for client sign-in.
function requestedDestination() {
    const destination = new URLSearchParams(location.search).get('returnTo');
    return destination && !destination.includes('#') ? destination + location.hash : destination;
}

function emailHint(search: string) {
    try { return normalizeEmail(new URLSearchParams(search).get('login_hint')); }
    catch { return ''; }
}

export default function Login() {
    const hint = useLocation({ select: location => emailHint(location.searchStr) });
    const [magicPath,setMagicPath]=useState('/login/magic');
    useEffect(()=>{const destination=requestedDestination();if(destination)setMagicPath('/login/magic?returnTo='+encodeURIComponent(loginDestination(destination,location.origin)));},[]);
    const { options } = useAuthOptions();
    const {options:mail}=useSignInMail();
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [typed, setTyped] = useState('');
    // An email typed here carries into the sign-in-link page, so it is never typed twice.
    const magicHref = typed ? `${magicPath}${magicPath.includes('?') ? '&' : '?'}login_hint=${encodeURIComponent(typed)}` : magicPath;
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setBusy(true); setError('');
        const form = new FormData(event.currentTarget);
        try {
            const result = await postJson('/api/identity/login', { email: form.get('email'), password: form.get('password') });
            // An account with a second factor, or one its workspace requires, finishes on the two-factor page.
            if (result.twoFactor) { location.assign('/two-factor' + (requestedDestination() ? '?returnTo=' + encodeURIComponent(requestedDestination()!) : '')); return; }
            location.assign(await signInDestination(requestedDestination(), location.origin, result.accountOnly));
        } catch (failure: any) { setError(failure.message); setBusy(false); }
    };
    return <IdentityFrame drawing={<SignInDrawing intro />}>
        <h1>Welcome back</h1>
        <p className="id-lede">Log in to your HappyToHelp workspace.</p>
        {options?.setupRequired && <p className="id-note" role="status">This installation has not been set up yet. <a href="/setup">Set up your workspace</a> to create the first owner account.</p>}
        {mail?.mailMode === 'local' && <p className="id-note" role="status"><code>rer dev</code> signs you in automatically as the local owner. Open the app address it prints. Email is suppressed during local development. No email is sent.</p>}
        {mail?.mailMode === 'unavailable' && <p className="id-note" role="status">Outbound email is off for this installation, so sign-in links and password resets are not sent. Sign in with your password, or ask whoever runs this installation for a one-time sign-in link.</p>}
        <Alert>{error}</Alert>
        <form method="post" onSubmit={submit}>
            <Field id="email" label="Email" type="email" autoComplete="username" placeholder="you@example.com" defaultValue={hint} onInput={event => setTyped(event.currentTarget.value.trim())} />
            <Field id="password" label="Password" type="password" autoComplete="current-password" placeholder="Your password" />
            <SubmitButton busy={busy} ready={true} busyLabel="Signing in…">Login</SubmitButton>
        </form>
        <div className="id-links">
            {mail?.mailMode !== 'local' && <a href="/forgot-password">Forgot your password?</a>}
            {mail?.mailMode === 'remote' && <a href={magicHref}>Email me a sign-in link</a>}
            {options?.registrationAvailable && <a href="/register">Create an account</a>}
        </div>
    </IdentityFrame>;
}
