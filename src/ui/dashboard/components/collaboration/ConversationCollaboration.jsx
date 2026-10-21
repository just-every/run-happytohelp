import React, {useEffect, useRef, useState} from 'react';

/**
 * The slim presence line inside the reply card. It says something only while another teammate is viewing or
 * typing here, or when live collaboration is down; otherwise it is an empty live region.
 * The parent passes parsed conversation socket frames and a sender that returns false while disconnected.
 */
export default function ConversationCollaboration({projectId, conversationId, currentUserId, socketEvent, sendSocket, hasDraft = false, isTyping = false}) {
    const [peers, setPeers] = useState([]), [connected, setConnected] = useState(false);
    const sender = useRef(sendSocket), flags = useRef({hasDraft, isTyping});
    sender.current = sendSocket; flags.current = {hasDraft, isTyping};
    useEffect(() => { setPeers([]); }, [projectId, conversationId]);
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
    const others = peers.filter(peer => peer.id !== currentUserId && peer.expiresAt > Date.now());
    const collision = others.filter(peer => peer.typing || peer.draft);
    const line = !connected ? 'Live collaboration disconnected'
        : collision.length ? `${collision.map(peer => `${peer.name} ${peer.typing ? 'is typing' : 'has an unsent draft'}`).join('; ')}. Check before replying.`
            : others.length ? `${others.map(peer => peer.name).join(', ')} viewing` : '';
    return <p className={`conversation-presence${collision.length ? ' is-collision' : ''}`} role="status" aria-live="polite">{line}</p>;
}
