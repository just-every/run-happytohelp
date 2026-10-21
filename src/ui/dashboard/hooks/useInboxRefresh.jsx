import { useCallback, useEffect, useRef, useState } from 'react';
import Api from '../api';
import { inboxViewCountsPath } from '../components/inboxViewDefinitions';
import { createInboxRefreshScheduler } from '../utils/inboxRefreshScheduler';
import { inboxSource, useInboxNavigationActions } from '../../native/inbox-navigation-state';

const REQUIRED_COUNT_KEYS = [ 'mine', 'open', 'unassigned', 'ai', 'closed', 'unread' ];

/**
 * Co-ordinates event-driven inbox list recovery and its aggregate view counts.
 * It deliberately has no polling loop. The counts and data version are published
 * to the shell, whose rail shows them beside every page.
 */
export default function useInboxRefresh({
    isGlobalInbox,
    projectId,
    lastConnected,
    isWindowFocused,
    delayMs = 100,
    initialCounts,
}) {
    const [ inboxViewCounts, setInboxViewCounts ] = useState(initialCounts || {});
    const [ inboxDataVersion, setInboxDataVersion ] = useState(0);
    const schedulerRef = useRef(null);
    const wasFocusedRef = useRef(isWindowFocused);
    const sourceKey = inboxSource(isGlobalInbox, projectId);
    const { publish } = useInboxNavigationActions();
    const sourceKeyRef = useRef(sourceKey);

    sourceKeyRef.current = sourceKey;

    const refreshInboxData = useCallback(() => {
        const entry = schedulerRef.current;

        if (entry?.sourceKey === sourceKeyRef.current) {
            entry.scheduler.invalidate();
        }
    }, []);

    const fetchInboxViewCounts = useCallback(() => {
        const entry = schedulerRef.current;

        if (entry?.sourceKey !== sourceKeyRef.current) {
            return Promise.resolve(undefined);
        }

        return entry.scheduler.loadInitialCounts();
    }, []);

    useEffect(() => {
        const scheduler = createInboxRefreshScheduler({
            delayMs,
            fetchCounts: ({ signal } = {}) => Api.get(
                inboxViewCountsPath(isGlobalInbox, projectId),
                undefined,
                { signal }
            ).then(result => {
                const counts = result?.data;

                if (!counts || REQUIRED_COUNT_KEYS.some(key => !Number.isFinite(counts[key]))) {
                    throw new Error('Inbox view counts were missing from the API response');
                }

                return counts;
            }),
            onInvalidate: () => setInboxDataVersion(version => version + 1),
            onCounts: setInboxViewCounts,
            onError: error => console.error('Unable to refresh inbox view counts', error),
        });

        schedulerRef.current = { scheduler, sourceKey };
        setInboxViewCounts(initialCounts || {});
        if (!initialCounts) scheduler.loadInitialCounts();

        return () => {
            scheduler.dispose();

            if (schedulerRef.current?.scheduler === scheduler) {
                schedulerRef.current = null;
            }
        };
    }, [ delayMs, isGlobalInbox, projectId, sourceKey, initialCounts ]);

    useEffect(() => {
        publish(sourceKey, inboxViewCounts, inboxDataVersion);
    }, [ publish, sourceKey, inboxViewCounts, inboxDataVersion ]);

    useEffect(() => {
        if (lastConnected) refreshInboxData();
    }, [ lastConnected, refreshInboxData ]);

    useEffect(() => {
        const regainedFocus = isWindowFocused && !wasFocusedRef.current;
        wasFocusedRef.current = isWindowFocused;

        if (regainedFocus) refreshInboxData();
    }, [ isWindowFocused, refreshInboxData ]);

    return {
        inboxDataVersion,
        inboxViewCounts,
        applyInboxViewCounts: setInboxViewCounts,
        refreshInboxData,
        fetchInboxViewCounts,
    };
}
