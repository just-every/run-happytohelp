import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {nativeRequest} from '../../../native/transport';
import {collaborationPath} from './mentions';

const CollaborationContext = createContext(null);

/**
 * One conversation's follow state, shared by the "+" start menu (Follow, Internal CC…) and Ticket › Summary › Followers.
 * A follower change anywhere arrives as a conversation socket activity of kind "followers" and is read again.
 */
export function CollaborationProvider({projectId, conversationId, socketEvent, children}) {
    const path = collaborationPath(projectId, conversationId);
    const [state, setState] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [reads, setReads] = useState(0);
    const currentPath = useRef(path);
    currentPath.current = path;
    useEffect(() => { setState(null); setError(''); setBusy(false); }, [path]);
    useEffect(() => {
        if (socketEvent?.type === 'activity' && socketEvent?.kind === 'followers') setReads(count => count + 1);
    }, [socketEvent]);
    useEffect(() => {
        let active = true;
        nativeRequest(`${path}/collaboration`).then(result => { if (active) setState(result.data); })
            .catch(failure => { if (active) setError(failure.message); });
        return () => { active = false; };
    }, [path, reads]);
    const mutate = useCallback(async (suffix, method, body) => {
        const requestPath = path;
        setBusy(true); setError('');
        try {
            const result = await nativeRequest(`${requestPath}/${suffix}`, {method, ...(body ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {})});
            if (currentPath.current !== requestPath) return false;
            setState(current => ({...current, ...result.data}));
            return true;
        } catch (failure) {
            if (currentPath.current === requestPath) setError(failure.message);
            return false;
        } finally {
            if (currentPath.current === requestPath) setBusy(false);
        }
    }, [path]);
    const value = useMemo(() => ({
        loaded: Boolean(state),
        following: Boolean(state?.following),
        followers: state?.followers || [],
        members: state?.members || [],
        canManageFollowers: Boolean(state?.canManageFollowers),
        busy,
        error,
        follow: () => mutate('follow', 'POST'),
        unfollow: () => mutate('follow', 'DELETE'),
        setFollowers: userIds => mutate('followers', 'PUT', {user_ids: userIds}),
    }), [state, busy, error, mutate]);
    return React.createElement(CollaborationContext.Provider, {value}, children);
}

/** following, followers, members, follow/unfollow and set followers for the open conversation. */
export default function useCollaboration() {
    const value = useContext(CollaborationContext);
    if (!value) throw new Error('useCollaboration is used outside the conversation it belongs to.');
    return value;
}
