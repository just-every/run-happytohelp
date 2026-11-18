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
    const writes = useRef({ path, tail: Promise.resolve(), pending: 0, version: null });
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
    // Consecutive edits in this panel wait for their own preceding acknowledgement.
    // Only that acknowledgement advances the queued version: another writer still gets a stale refusal.
    // A failed/unknown write also refuses the edits behind it, without replaying any command.
    const mutate = useCallback(operation => {
        if (writes.current.path !== path) writes.current = { path, tail: Promise.resolve(), pending: 0, version: null };
        const queue = writes.current;
        if (!queue.pending) queue.version = loadedVersion.current;
        queue.pending++;
        const result = queue.tail.then(async () => {
            if (current.current !== path) throw new Error('Open the ticket again before applying changes.');
            const record = await operation(queue.version);
            queue.version = record.ticket_version;
            apply(record);
            return record;
        });
        queue.tail = result;
        const settled = () => { if (!--queue.pending) queue.tail = Promise.resolve(); };
        result.then(settled, settled);
        return result;
    }, [ apply, path ]);
    const save = useCallback(changes => mutate(async version => {
        const result = await nativeRequest(path, json('PATCH', { ...changes, expected_version: version }));
        return result.data;
    }), [ mutate, path ]);
    const reload = useCallback(async () => {
        const result = await nativeRequest(path);
        apply(result.data);
        return result.data;
    }, [ apply, path ]);
    return { ticket, settings, error, save, reload, apply, mutate, manage: Boolean(settings?.permissions?.manage) };
}
