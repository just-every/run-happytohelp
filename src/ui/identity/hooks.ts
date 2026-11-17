import { useEffect, useState } from 'react';
import { nativeRequest } from '../native/transport';

export const postJson = (path: string, body: unknown) => nativeRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** False while the server-rendered page is still inert; forms stay disabled until React owns them. */
export function useHydrated() {
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => setHydrated(true), []);
    return hydrated;
}

export interface AuthOptions { localOwnerEntry?: boolean; setupRequired: boolean; registrationAvailable: boolean; recoveryAvailable: boolean }

export function useSignInMail() {
    const [options,setOptions]=useState<{mailMode:'local'|'remote'|'unavailable'}|null>(null);
    const [failed,setFailed]=useState(false);
    useEffect(()=>{let active=true;nativeRequest('/api/identity/sign-in-options').then(value=>{if(active)setOptions(value)}).catch(()=>{if(active)setFailed(true)});return()=>{active=false}},[]);
    return {options,failed};
}

/** What this installation offers a signed-out visitor. `options` is null until known; `failed` if it could not be read. */
export function useAuthOptions() {
    const [options, setOptions] = useState<AuthOptions | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let active = true;
        nativeRequest('/api/identity/auth-options').then(result => { if (active) setOptions(result); }).catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, []);
    return { options, failed };
}

export type LinkKind = 'invitation' | 'reset' | 'verify-email';
export type LinkProblemState = 'missing' | 'invalid' | 'expired' | 'used';
export interface LinkInfo {
    state: LinkProblemState | 'valid';
    email?: string; workspace?: string; role?: string; projectId?: string; accountExists?: boolean;
    viewer?: { signedIn: boolean; email: string | null; matches: boolean };
}

/** Reads the `token` in the page address and asks the server what the link will do, without consuming it. */
export function useLinkStatus(kind: LinkKind, revision = 0) {
    const [token, setToken] = useState<string | null>(null);
    const [info, setInfo] = useState<LinkInfo | null>(null);
    const [failure, setFailure] = useState('');
    useEffect(() => {
        let active = true;
        const found = new URLSearchParams(location.search).get('token')?.trim() || '';
        setToken(found);
        if (!found) { setInfo({ state: 'missing' }); return; }
        postJson('/api/identity/link-status', { kind, token: found })
            .then(result => { if (active) setInfo(result); })
            .catch(error => { if (active) setFailure(error.message); });
        return () => { active = false; };
    }, [kind, revision]);
    return { token, info, failure };
}
