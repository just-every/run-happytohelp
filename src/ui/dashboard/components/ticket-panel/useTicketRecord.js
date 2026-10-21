import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { nativeRequest } from '../../../native/transport';
import { ChatContext } from '../../contexts/ChatContext';
import { json, ticketPath } from '../tickets/ticket-model';

/**
 * The ticket record and its settings, read once for the Ticket tab: the Summary saves Status and Priority with
 * `expected_version`, and Ticket fields saves the rest against the same version, so neither works from a stale copy.
 */
export default function useTicketRecord(conversation, reads) {
    const { updateConversation } = useContext(ChatContext);
    const base = ticketPath(conversation.project_id);
    const path = `${ base }/conversations/${ encodeURIComponent(conversation.id) }/ticket`;
    const [ ticket, setTicket ] = useState(null), [ settings, setSettings ] = useState(null), [ error, setError ] = useState('');
    const [ staleReads, setStaleReads ] = useState(0);
    const current = useRef(path), loadedVersion = useRef(null);
    current.current = path;
    useEffect(() => { setTicket(null); setSettings(null); setError(''); loadedVersion.current = null; }, [ path ]);
    useEffect(() => {
        let active = true;
        Promise.all([ nativeRequest(path), nativeRequest(`${ base }/ticket-settings`) ]).then(([ record, definitions ]) => {
            if (!active) return;
            loadedVersion.current = record.data.ticket_version;
            setTicket(record.data); setSettings(definitions.data); setError('');
        }).catch(failure => { if (active) setError(failure.message); });
        return () => { active = false; };
    }, [ base, path, reads, staleReads ]);
    // A change made elsewhere (another teammate, a workflow, the header's Close) moves the conversation's ticket version.
    useEffect(() => {
        if (conversation.ticket_version != null && loadedVersion.current != null && conversation.ticket_version !== loadedVersion.current) setStaleReads(count => count + 1);
    }, [ conversation.ticket_version ]);
    const apply = useCallback(record => {
        if (current.current !== path) return;
        loadedVersion.current = record.ticket_version;
        setTicket(record);
        updateConversation(conversation.id, record);
    }, [ conversation.id, path, updateConversation ]);
    // Saves changed fields against the version the agent saw; a refused write leaves the record as the server has it.
    const save = useCallback(async changes => {
        const result = await nativeRequest(path, json('PATCH', { ...changes, expected_version: ticket.ticket_version }));
        apply(result.data);
        return result.data;
    }, [ apply, path, ticket?.ticket_version ]);
    const reload = useCallback(async () => {
        const result = await nativeRequest(path);
        apply(result.data);
        return result.data;
    }, [ apply, path ]);
    return { ticket, settings, error, save, reload, manage: Boolean(settings?.permissions?.manage) };
}
