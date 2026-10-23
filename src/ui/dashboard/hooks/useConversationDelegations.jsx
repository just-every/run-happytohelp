import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Api from '../api';

const activeStatuses = new Set([ 'queued', 'running', 'needs_input' ]);

const collection = response => Array.isArray(response?.data) ? response.data : [];
const record = response => response?.data || null;

const byNewestFirst = (left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0);

export default function useConversationDelegations({ conversationId, projectId, isSetupOpen = false }) {
    const [ devices, setDevices ] = useState([]);
    const [ delegations, setDelegations ] = useState([]);
    const [ pairing, setPairing ] = useState(null);
    const [ error, setError ] = useState('');
    const [ isLoading, setIsLoading ] = useState(false);
    const refreshVersion = useRef(0);
    const scopeKey = useMemo(() => `${ projectId || '' }:${ conversationId || '' }`, [ conversationId, projectId ]);
    const scopeRef = useRef(scopeKey);

    const basePath = useMemo(() => {
        if (!projectId || !conversationId) return null;
        return `/projects/${ projectId }/conversations/${ conversationId }/delegations`;
    }, [ conversationId, projectId ]);
    const devicesPath = projectId ? `/projects/${ projectId }/local-agents` : null;

    const refresh = useCallback(async ({ quiet = false } = {}) => {
        if (!basePath || !devicesPath) return;

        const requestScope = scopeKey;
        const requestVersion = ++refreshVersion.current;
        if (!quiet) setIsLoading(true);

        try {
            const [ devicesResponse, delegationsResponse ] = await Promise.all([
                Api.get(devicesPath),
                Api.get(basePath),
            ]);
            if (requestScope !== scopeRef.current || requestVersion !== refreshVersion.current) return;

            setDevices(collection(devicesResponse));
            setDelegations(collection(delegationsResponse).sort(byNewestFirst));
            setError('');
        } catch (requestError) {
            if (requestScope !== scopeRef.current || requestVersion !== refreshVersion.current) return;
            setError(requestError.message || 'Could not load local-agent work.');
        } finally {
            if (requestScope === scopeRef.current && requestVersion === refreshVersion.current) setIsLoading(false);
        }
    }, [ basePath, devicesPath, scopeKey ]);

    const replaceDelegation = useCallback((delegation, requestScope) => {
        if (!delegation?.id || requestScope !== scopeRef.current) return;
        setDelegations(current => [ delegation, ...current.filter(job => job.id !== delegation.id) ].sort(byNewestFirst));
    }, []);

    useEffect(() => {
        scopeRef.current = scopeKey;
        refreshVersion.current += 1;
        setDevices([]);
        setDelegations([]);
        setPairing(null);
        setError('');
        refresh();
    }, [ refresh, scopeKey ]);

    const hasActiveDelegation = delegations.some(job => activeStatuses.has(job.status));
    useEffect(() => {
        const poll = () => refresh({ quiet: true });
        const interval = window.setInterval(poll, isSetupOpen ? 2000 : hasActiveDelegation ? 5000 : 15000);
        return () => window.clearInterval(interval);
    }, [ hasActiveDelegation, isSetupOpen, refresh ]);

    const createPairing = useCallback(async () => {
        if (!devicesPath) return null;

        const requestScope = scopeKey;
        try {
            const response = await Api.create(`${ devicesPath }/pairings`);
            const nextPairing = record(response);
            if (!nextPairing?.id || !nextPairing?.code || !nextPairing?.expires_at) {
                throw new Error('The server did not return a usable pairing code.');
            }
            if (requestScope !== scopeRef.current) return null;
            setPairing(nextPairing);
            setError('');
            return nextPairing;
        } catch (requestError) {
            if (requestScope !== scopeRef.current) throw requestError;
            setError(requestError.message || 'Could not generate a pairing code.');
            throw requestError;
        }
    }, [ devicesPath, scopeKey ]);

    const createDelegation = useCallback(async ({ deviceId, instructions, mode, timeLimitMinutes = 15 }) => {
        if (!basePath) return null;

        const requestScope = scopeKey;
        try {
            const response = await Api.create(basePath, {
                device_id: deviceId,
                time_limit_minutes: timeLimitMinutes,
                mode,
                instructions,
                request_id: uuidv4(),
            });
            const delegation = record(response);
            replaceDelegation(delegation, requestScope);
            if (requestScope !== scopeRef.current) return null;
            setError('');
            return delegation;
        } catch (requestError) {
            if (requestScope === scopeRef.current) setError(requestError.message || 'Could not delegate this conversation.');
            throw requestError;
        }
    }, [ basePath, replaceDelegation, scopeKey ]);

    const cancelDelegation = useCallback(async delegationId => {
        if (!basePath || !delegationId) return null;

        const requestScope = scopeKey;
        try {
            const response = await Api.create(`${ basePath }/${ delegationId }/cancel`);
            const delegation = record(response);
            replaceDelegation(delegation, requestScope);
            if (requestScope !== scopeRef.current) return null;
            setError('');
            return delegation;
        } catch (requestError) {
            if (requestScope === scopeRef.current) setError(requestError.message || 'Could not request cancellation.');
            throw requestError;
        }
    }, [ basePath, replaceDelegation, scopeKey ]);

    const sendInput = useCallback(async (delegationId, message, reviewedLastMessageId = null) => {
        if (!basePath || !delegationId) return null;

        const requestScope = scopeKey;
        try {
            const response = await Api.create(`${ basePath }/${ delegationId }/input`, {
                message,
                request_id: uuidv4(),
                ...(reviewedLastMessageId ? { reviewed_last_message_id: reviewedLastMessageId } : {}),
            });
            const delegation = record(response);
            replaceDelegation(delegation, requestScope);
            if (requestScope !== scopeRef.current) return null;
            setError('');
            return delegation;
        } catch (requestError) {
            if (requestScope === scopeRef.current) setError(requestError.message || 'Could not send the requested input.');
            throw requestError;
        }
    }, [ basePath, replaceDelegation, scopeKey ]);

    const revokeDevice = useCallback(async deviceId => {
        if (!devicesPath || !deviceId) return;

        const requestScope = scopeKey;
        try {
            await Api.remove(`${ devicesPath }/${ deviceId }`);
            if (requestScope !== scopeRef.current) return;
            await refresh({ quiet: true });
            setError('');
        } catch (requestError) {
            if (requestScope === scopeRef.current) setError(requestError.message || 'Could not revoke this device.');
            throw requestError;
        }
    }, [ devicesPath, refresh, scopeKey ]);

    const runFollowUp = useCallback(async (delegationId, optionId) => {
        if (!basePath || !delegationId || !optionId) return null;
        const requestScope = scopeKey;
        const suffix = `follow-up-actions/${ encodeURIComponent(optionId) }`;
        try {
            const response = await Api.create(`${ basePath }/${ delegationId }/result/${ suffix }`);
            const delegation = record(response);
            replaceDelegation(delegation, requestScope);
            if (requestScope !== scopeRef.current) return null;
            setError('');
            // Follow-ups create a separate job; refresh also updates device capacity.
            await refresh({ quiet: true });
            return delegation;
        } catch (requestError) {
            if (requestScope === scopeRef.current) {
                await refresh({ quiet: true });
                if (requestScope === scopeRef.current) setError(requestError.message || 'Could not action this result.');
            }
            throw requestError;
        }
    }, [ basePath, refresh, replaceDelegation, scopeKey ]);

    const clearPairing = useCallback(() => setPairing(null), []);

    const activeDelegation = delegations.find(job => activeStatuses.has(job.status) && !job.authority?.expired) || null;
    const latestDelegation = delegations[0] || null;

    return {
        activeDelegation,
        createDelegation,
        createPairing,
        clearPairing,
        delegations,
        devices,
        error,
        isLoading,
        latestDelegation,
        pairing,
        cancelDelegation,
        refresh,
        revokeDevice,
        sendInput,
        runFollowUp,
    };
}
