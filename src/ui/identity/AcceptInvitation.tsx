import { useState, type FormEvent } from 'react';
import IdentityFrame from './IdentityFrame';
import LinkProblem from './LinkProblem';
import { Alert, Field, NewPasswordField, SubmitButton } from './fields';
import { postJson, useHydrated, useLinkStatus, type LinkInfo } from './hooks';

const roleName = (role?: string) => role === 'operator' ? 'Agent' : role === 'admin' ? 'Admin' : 'Owner';
const Facts = ({ info }: { info: LinkInfo }) => <dl className="id-facts"><div><dt>Workspace</dt><dd>{info.workspace}</dd></div><div><dt>Invited email</dt><dd>{info.email}</dd></div><div><dt>Role</dt><dd>{roleName(info.role)}</dd></div></dl>;

export default function AcceptInvitation() {
    const ready = useHydrated();
    const [revision, setRevision] = useState(0);
    const { token, info, failure } = useLinkStatus('invitation', revision);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [joined, setJoined] = useState<'member' | null>(null);
    const signIn = `/login?returnTo=${encodeURIComponent('/accept-invitation?token=' + (token ?? ''))}`;

    // A new person chooses a name and password. Someone who registered in the meantime is sent to sign in instead.
    const createAccount = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setBusy(true); setError('');
        const form = new FormData(event.currentTarget);
        try {
            const result = await postJson('/api/identity/accept-token', { token, name: form.get('name'), password: form.get('password') });
            location.assign(result.twoFactor ? '/two-factor?returnTo=' + encodeURIComponent(result.destination) : result.destination);
        }
        catch (problem: any) { if (problem.status === 409) setRevision(value => value + 1); else setError(problem.message); }
        finally { setBusy(false); }
    };
    // A signed-in invitee accepts as that account, then moves into the workspace.
    const acceptAsMember = async () => {
        setBusy(true); setError('');
        try { await postJson('/api/identity/accept-invitation', { token }); setJoined('member'); } catch (problem: any) { setError(problem.message); } finally { setBusy(false); }
    };
    const openWorkspace = async () => {
        setBusy(true); setError('');
        try { await postJson('/api/identity/switch-project', { projectId: info?.projectId }); location.assign(`/projects/${encodeURIComponent(info?.projectId ?? '')}/conversations`); } catch (problem: any) { setError(problem.message); setBusy(false); }
    };

    if (joined === 'member') return <IdentityFrame>
        <h1>You have joined {info?.workspace}</h1>
        <p className="id-lede">The invitation is accepted and you are now part of the workspace.</p>
        <Alert>{error}</Alert>
        <div className="id-actions"><button className="pill pill--ink" disabled={busy} onClick={openWorkspace}>{busy ? 'Opening…' : 'Open workspace'}</button></div>
    </IdentityFrame>;
    if (!info) return <IdentityFrame><h1>Your invitation</h1>{failure ? <Alert>{failure}</Alert> : <p className="id-lede" role="status">Checking your invitation…</p>}</IdentityFrame>;
    if (info.state !== 'valid') return <IdentityFrame><LinkProblem state={info.state} noun="invitation"><a className="pill pill--ink" href="/login">Sign in</a></LinkProblem></IdentityFrame>;

    if (info.viewer?.signedIn && info.viewer.matches) return <IdentityFrame>
        <h1>Join {info.workspace}</h1>
        <p className="id-lede">You are signed in as <strong>{info.email}</strong>, the address this invitation was sent to.</p>
        <Facts info={info} /><Alert>{error}</Alert>
        <div className="id-actions"><button className="pill pill--ink" disabled={busy || !ready} onClick={acceptAsMember}>{busy ? 'Accepting…' : 'Accept invitation'}</button></div>
    </IdentityFrame>;
    if (info.viewer?.signedIn) return <IdentityFrame>
        <h1>This invitation is for another account</h1>
        <p className="id-lede">It was sent to <strong>{info.email}</strong>, but you are signed in as <strong>{info.viewer.email}</strong>. Sign in with the invited account to accept it.</p>
        <Facts info={info} />
        <div className="id-actions"><a className="pill pill--ink" href={signIn}>Sign in as {info.email}</a></div>
    </IdentityFrame>;
    if (info.accountExists) return <IdentityFrame>
        <h1>Sign in to join {info.workspace}</h1>
        <p className="id-lede"><strong>{info.email}</strong> already has an account. Sign in to accept this invitation.</p>
        <Facts info={info} />
        <div className="id-actions"><a className="pill pill--ink" href={signIn}>Sign in</a></div>
    </IdentityFrame>;
    return <IdentityFrame>
        <h1>Join {info.workspace}</h1>
        <p className="id-lede">You have been invited to <strong>{info.workspace}</strong>. Create your account to accept.</p>
        <Facts info={info} /><Alert>{error}</Alert>
        <form method="post" onSubmit={createAccount}>
            <Field id="name" label="Your name" autoComplete="name" maxLength={200} />
            <NewPasswordField />
            <SubmitButton busy={busy} ready={ready} busyLabel="Creating…">Create account and join</SubmitButton>
        </form>
        <div className="id-links"><a href={signIn}>Already have an account? Sign in</a></div>
    </IdentityFrame>;
}
