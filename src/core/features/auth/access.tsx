import { useEffect, useState, type FormEvent } from 'react'
import type { Operator, Session } from "../../../vendor/base/modules/operator-auth/index.mjs"

type SessionRow = { id: string; kind: string; createdAt: number; expiresAt: number; active: boolean }
type OperatorRow = Operator & { signInUrl?: string }
export function OperatorAccess({ timezone = 'UTC' }: { timezone?: string }) {
  const [session, setSession] = useState<Session>()
  const [operators, setOperators] = useState<OperatorRow[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<string>()
  async function request(path: string, input?: object) {
    const response = await fetch(`/auth/${path}`, input ? {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    } : undefined)
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? 'Request failed')
    }
    if (response.status === 204) { await response.text(); return undefined }
    return response.json()
  }
  async function refresh(operatorId?: string) {
    const current = await request('session') as Session
    setSession(current)
    if (current.operator.role !== 'member') setOperators(await request('operators') as OperatorRow[])
    setSessions(await request(`sessions${operatorId ? `?operatorId=${encodeURIComponent(operatorId)}` : ''}`) as SessionRow[])
  }
  useEffect(() => { void refresh().catch((error: Error) => setMessage(error.message)) }, [])
  async function mutate(path: string, input: object) {
    try {
      await request(path, input)
      if (path === 'session/revoke' && 'sessionId' in input && input.sessionId === session?.id) {
        window.location.href = '/signin'
        return
      }
      setMessage('Saved.'); await refresh(selected)
    }
    catch (error) { setMessage((error as Error).message) }
  }
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await mutate('invite', { email: form.get('email'), displayName: form.get('displayName'), role: form.get('role'), returnTo: '/app' })
  }
  // A wrong sign-in email is corrected here: after a fresh proof (rer signin, a
  // recent email-link sign-in, or the step-up link sent to the current address).
  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = new FormData(event.currentTarget).get('email')
    try { await request('email', { email }); setMessage('Saved.'); await refresh(selected) }
    catch (error) {
      if ((error as Error).message !== 'step_up_required') { setMessage((error as Error).message); return }
      try {
        await request('step-up', { action: 'email:change', returnTo: '/app' })
        setMessage('To confirm it is you, open the link just sent to your current email, then save again.')
      }
      catch (inner) { setMessage((inner as Error).message) }
    }
  }
  async function changeName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await mutate('display-name', { displayName: new FormData(event.currentTarget).get('displayName') })
  }
  return <section className="auth-panel">
    <h2>Operator access</h2>
    {session ? <p>{session.operator.email} · {session.operator.role}</p> : null}
    {session ? <form key={session.operator.displayName} onSubmit={changeName}>
      <label>Your name <input name="displayName" required maxLength={120} autoComplete="name" defaultValue={session.operator.displayName} /></label>
      <button type="submit">Save name</button>
    </form> : null}
    {session ? <form key={session.operator.email} onSubmit={changeEmail}>
      <label>Your sign-in email <input name="email" type="email" required defaultValue={session.operator.email} /></label>
      <button type="submit">Save email</button>
    </form> : null}
    <button onClick={() => { void request('signout', {}).then(() => { window.location.href = '/signin' }).catch((error: Error) => setMessage(error.message)) }}>Sign out</button>
    {message ? <p role="status">{message}</p> : null}
    {session && session.operator.role !== 'member' ? <>
      {session.operator.role === 'owner' ? <p><a href="/auth/settings/identity">Business and sign-in settings</a></p> : null}
      <h3>Invite an operator</h3>
      <form onSubmit={invite}>
        <label>Name <input name="displayName" required maxLength={200} /></label>
        <label>Email <input name="email" type="email" required /></label>
        <label>Role <select name="role"><option value="member">Member</option>{session.operator.role === 'owner' ? <><option value="admin">Admin</option><option value="owner">Owner</option></> : null}</select></label>
        <button type="submit">Send invitation</button>
      </form>
      <h3>Operators</h3>
      <ul>{operators.map((operator) => <li key={operator.id}>
        <p>{operator.email} · {operator.role} · {operator.status}</p>
        {operator.signInUrl ? <a href={operator.signInUrl}>Sign in as {operator.displayName}</a> : null}{' '}
        <button onClick={() => { setSelected(operator.id); void refresh(operator.id).catch((error: Error) => setMessage(error.message)) }}>Show sessions</button>{' '}
        {operator.status !== 'invited' ? <button onClick={() => void mutate('operator/status', { operatorId: operator.id, status: operator.status === 'active' ? 'inactive' : 'active' })}>{operator.status === 'active' ? 'Deactivate' : 'Reactivate'}</button> : null}
        {session.operator.role === 'owner' ? <label> Role <select aria-label={`Role for ${operator.email}`} value={operator.role} onChange={(event) => void mutate('operator/role', { operatorId: operator.id, role: event.target.value })}><option value="member">Member</option><option value="admin">Admin</option><option value="owner">Owner</option></select></label> : null}
      </li>)}</ul>
    </> : null}
    <h3>Sessions</h3>
    {selected ? <button onClick={() => { setSelected(undefined); void refresh().catch((error: Error) => setMessage(error.message)) }}>Show my sessions</button> : null}
    <ul>{sessions.map((item) => <li key={item.id}>{item.kind} · {item.active ? 'Active' : 'Ended'} · expires {new Date(item.expiresAt).toLocaleString(undefined, { timeZone: timezone })}{' '}{item.active ? <button onClick={() => void mutate('session/revoke', { sessionId: item.id })}>Revoke</button> : null}</li>)}</ul>
  </section>
}
