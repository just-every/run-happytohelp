import React, {useEffect, useRef, useState} from 'react';

/**
 * The slim presence line inside the reply card. It says something only while another teammate is viewing or
 * typing here, or when live collaboration is down; otherwise it is an empty live region.
 * The parent supplies the socket's connection state. The initial handshake is silent.
 */
export default function ConversationCollaboration({projectId, conversationId, currentUserId, connected, socketEvent, sendSocket, hasDraft = false, isTyping = false}) {
    const [peers, setPeers] = useState([]);
    const sender = useRef(sendSocket), flags = useRef({hasDraft, isTyping});
    sender.current = sendSocket; flags.current = {hasDraft, isTyping};
    useEffect(() => { setPeers([]); }, [projectId, conversationId]);
    useEffect(() => {
        if (socketEvent?.type === 'presence' && socketEvent.conversationId === conversationId) {
            setPeers(socketEvent.peers || []);
        }
    }, [socketEvent, conversationId]);
    useEffect(() => {
        const send = () => sender.current?.({type: 'presence', viewing: true, typing: flags.current.isTyping, draft: flags.current.hasDraft});
        const heartbeat = setInterval(send, 10000);
        const expiry = setInterval(() => setPeers(current => current.filter(peer => peer.expiresAt > Date.now())), 1000);
        return () => { clearInterval(heartbeat); clearInterval(expiry); sender.current?.({type: 'presence', viewing: false}); };
    }, [conversationId, projectId]);
    useEffect(() => {
        if (connected) sender.current?.({type: 'presence', viewing: true, typing: isTyping, draft: hasDraft});
    }, [connected, hasDraft, isTyping, conversationId]);
    const others = connected ? peers.filter(peer => peer.id !== currentUserId && peer.expiresAt > Date.now()) : [];
    const collision = others.filter(peer => peer.typing || peer.draft);
    const line = connected === false ? 'Live collaboration disconnected'
        : collision.length ? `${collision.map(peer => `${peer.name} ${peer.typing ? 'is typing' : 'has an unsent draft'}`).join('; ')}. Check before replying.`
            : others.length ? `${others.map(peer => peer.name).join(', ')} viewing` : '';
    return <p className={`conversation-presence${collision.length ? ' is-collision' : ''}`} role="status" aria-live="polite">{line}</p>;
}
