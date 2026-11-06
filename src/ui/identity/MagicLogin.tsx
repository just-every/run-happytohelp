import { useEffect, useState, type FormEvent } from 'react';
import IdentityFrame from './IdentityFrame';
import { Alert, Field, SubmitButton } from './fields';
import { postJson, useSignInMail, useHydrated } from './hooks';
import { signInDestination } from './sign-in-destination';

export default function MagicLogin() {
 const ready = useHydrated();
 const {options,failed}=useSignInMail();
 const local=options?.mailMode==='local';
 const available=options?.mailMode==='remote';
 const [returnTo,setReturnTo]=useState(''),[hint,setHint]=useState('');
 const [token, setToken] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [sent, setSent] = useState('');
 useEffect(() => {
  const capture = () => {
   const found = new URLSearchParams(location.hash.slice(1)).get('token') || '';
   if (!found) return;
   setToken(found);setSent('');setError('');
   setReturnTo(new URLSearchParams(location.search).get('returnTo')||'');
   // Remove the capability after capture, without consuming it or creating history.
   history.replaceState(null, '', '/login/magic'+location.search);
  };
  setReturnTo(new URLSearchParams(location.search).get('returnTo')||'');setHint(new URLSearchParams(location.search).get('login_hint')||'');capture();
  window.addEventListener('hashchange',capture);
  return () => window.removeEventListener('hashchange',capture);
 }, []);

 const submit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault(); setBusy(true); setError('');
  try {
   if (token) {
    const result=await postJson('/api/identity/magic-link/consume', { token,returnTo });
    if (result.twoFactor) { location.assign('/two-factor?returnTo=' + encodeURIComponent(result.destination)); return; }
    location.assign(await signInDestination(result.destination, location.origin));
   } else {
    const result = await postJson('/api/identity/magic-link', { email: new FormData(event.currentTarget).get('email'),returnTo });
    setSent(result.message); setBusy(false);
   }
  } catch (failure: any) { setError(failure.message); setBusy(false); }
 };
 return <IdentityFrame>
  <h1>{token ? 'Sign in to your workspace' : local ? 'Local owner sign-in' : available ? 'Email me a sign-in link' : 'Email sign-in'}</h1>
  <p className="id-lede">{token ? 'Press Sign in to use your one-time link. Links expire after 15 minutes.' : local ? 'rer dev signs you in automatically as the local owner. Open the app address it prints. Email is suppressed during local development. No email is sent.' : available ? 'Enter the email address you use for your workspace.' : !options&&!failed ? 'Checking whether email sign-in is available…' : failed ? 'Email sign-in availability could not be checked. You can still use your password.' : 'Outbound email is off for this installation, so sign-in links are not sent. Use your password, or ask whoever runs this installation for a one-time sign-in link.'}</p>
  <Alert>{error}</Alert>
  {sent && <p role="status" className="id-note">{sent}</p>}
  {(token||available)&&<form method="post" onSubmit={submit}>
   {!token && <Field key={hint} id="email" label="Email" type="email" autoComplete="email" defaultValue={hint} />}
   <SubmitButton busy={busy} ready={ready} busyLabel={token ? 'Signing in…' : 'Requesting link…'}>{token ? 'Sign in' : 'Email me a sign-in link'}</SubmitButton>
  </form>}
  <div className="id-links"><a href="/login">Use your password</a>{token&&available && <a href="/login/magic">Request a new link</a>}</div>
 </IdentityFrame>;
}
