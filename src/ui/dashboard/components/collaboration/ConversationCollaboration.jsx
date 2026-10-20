import React, {useEffect, useRef, useState} from 'react';
import {nativeRequest} from '../../../native/transport';
import {collaborationPath} from './mentions';

/** Parent passes parsed conversation socket frames and a sender returning false while disconnected. */
export default function ConversationCollaboration({projectId, conversationId, currentUserId, socketEvent, sendSocket, hasDraft = false, isTyping = false}) {
    const [state, setState] = useState(null), [selected, setSelected] = useState([]), [peers, setPeers] = useState([]);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [connected, setConnected] = useState(false);
    const sender = useRef(sendSocket), flags = useRef({hasDraft, isTyping});
    sender.current = sendSocket; flags.current = {hasDraft, isTyping};
    const path = collaborationPath(projectId, conversationId);
    const currentPath = useRef(path); currentPath.current = path;
    useEffect(() => { setPeers([]); }, [path]);
    useEffect(() => {
        let active = true; setState(null); setError(''); setBusy(false);
        nativeRequest(`${path}/collaboration`).then(result => {
            if (active) { setState(result.data); setSelected(result.data.followers.map(member => member.id)); }
        }).catch(failure => { if (active) setError(failure.message); });
        return () => { active = false; };
    }, [path, socketEvent?.type === 'activity' && socketEvent?.kind === 'followers' ? socketEvent : null]);
    useEffect(() => {
        if (socketEvent?.type === 'presence' && socketEvent.conversationId === conversationId) {
            setPeers(socketEvent.peers || []); setConnected(true);
        }
    }, [socketEvent, conversationId]);
    useEffect(() => {
        const send = () => setConnected(sender.current?.({type: 'presence', viewing: true, typing: flags.current.isTyping, draft: flags.current.hasDraft}) !== false && !!sender.current);
        send(); const heartbeat = setInterval(send, 10000);
        const expiry = setInterval(() => setPeers(current => current.filter(peer => peer.expiresAt > Date.now())), 1000);
        return () => { clearInterval(heartbeat); clearInterval(expiry); sender.current?.({type: 'presence', viewing: false}); };
    }, [conversationId, projectId]);
    useEffect(() => {
        setConnected(sender.current?.({type: 'presence', viewing: true, typing: isTyping, draft: hasDraft}) !== false && !!sender.current);
    }, [hasDraft, isTyping, conversationId]);
    const mutate = async (suffix, method, body) => {
        setBusy(true); setError('');
        try {
            const result = await nativeRequest(`${path}/${suffix}`, {method, ...(body ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {})});
            if (currentPath.current !== path) return;
            setState(current => ({...current, ...result.data})); setSelected(result.data.followers.map(member => member.id));
        } catch (failure) { if (currentPath.current === path) setError(failure.message); }
        if (currentPath.current === path) setBusy(false);
    };
    const others = peers.filter(peer => peer.id !== currentUserId && peer.expiresAt > Date.now());
    const collision = others.filter(peer => peer.typing || peer.draft);
    return <div className="conversation-follow flex-wrap" role="group" aria-label="Ticket collaboration">
        {state && <>
            <button type="button" className="btn btn-sm btn-outline-primary" aria-pressed={state.following} disabled={busy}
                onClick={() => mutate('follow', state.following ? 'DELETE' : 'POST')}>{state.following ? 'Following' : 'Follow'}</button>
            {state.followers.length > 0 && <span>Followed by {state.followers.map(person => person.name).join(', ')}</span>}
            {state.canManageFollowers && <details>
                <summary>Internal CC</summary>
                <label className="form-label">Teammates following this ticket
                    <select multiple className="form-select form-select-sm" value={selected} disabled={busy}
                        onChange={event => setSelected(Array.from(event.target.selectedOptions, option => option.value))}>
                        {state.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
                    </select>
                </label>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => mutate('followers', 'PUT', {user_ids: selected})}>Save followers</button>
            </details>}
        </>}
        <span role="status" aria-live="polite">
            {!connected ? 'Live collaboration disconnected' : collision.length
                ? `${collision.map(peer => `${peer.name} ${peer.typing ? 'is typing' : 'has an unsent draft'}`).join('; ')}. Check before replying.`
                : others.length ? `${others.map(peer => peer.name).join(', ')} viewing` : ''}
        </span>
        {error && <span className="text-danger" role="alert">{error}</span>}
    </div>;
}
