import { ChatContext } from '../contexts/ChatContext';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
    fetchInitialConversationBuckets,
    hasNextPage as hasNextResponsePage,
    isAbortedRequest,
} from '../components/conversationRequestLifecycle';

function useConversationLoading({
    conversationId,
    projectId,
    conversationProjectId,
    buckets,
    fetchConversation,
    fetchBucketList,
    setBuckets,
    setConversationData,
    setIsMainVisible,
    lastConnected,
}) {
    const {initialInboxReadsId, initialInboxConversationId, completeInitialInboxMount} = useContext(ChatContext);
    const [ isLoading, setIsLoading ] = useState(false);
    const [ isRefreshing, setIsRefreshing ] = useState(false);
    const [ isLoadingMore, setIsLoadingMore ] = useState(false);
    const [ hasNextPage, setHasNextPage ] = useState(true);
    const [ readyConversationId, setReadyConversationId ] = useState(null);
    const [ loadError, setLoadError ] = useState(null);
    const [ loadMoreError, setLoadMoreError ] = useState(null);
    const activeConversationIdRef = useRef(conversationId);
    const bucketsRef = useRef(buckets);
    const fetchConversationRef = useRef(fetchConversation);
    const fetchBucketListRef = useRef(fetchBucketList);
    const activeRequest = useRef(null);
    const requestGeneration = useRef(0);
    const queuedQuietRefresh = useRef(false);
    const loadConversationRef = useRef(null);

    activeConversationIdRef.current = conversationId;
    bucketsRef.current = buckets;
    fetchConversationRef.current = fetchConversation;
    fetchBucketListRef.current = fetchBucketList;

    const requestIsCurrent = request => (
        activeRequest.current === request
        && request.generation === requestGeneration.current
        && request.conversationId === activeConversationIdRef.current
    );

    const finishRequest = request => {
        if (!requestIsCurrent(request)) {
            return;
        }

        activeRequest.current = null;
        if (queuedQuietRefresh.current) {
            queuedQuietRefresh.current = false;
            loadConversationRef.current(true);
        }
    };

    const loadOlderBuckets = useCallback(() => {
        const oldestBucket = bucketsRef.current[0];
        if (!oldestBucket || !hasNextPage || activeRequest.current) {
            return;
        }

        const controller = new AbortController();
        const request = {
            controller,
            conversationId,
            generation: ++requestGeneration.current,
        };
        activeRequest.current = request;
        setLoadMoreError(null);
        setIsLoadingMore(true);

        fetchBucketListRef.current(
            conversationId,
            { created_before: oldestBucket.created_at },
            conversationProjectId,
            { signal: controller.signal },
        )
            .then(result => {
                if (requestIsCurrent(request)) {
                    setHasNextPage(hasNextResponsePage(result, 'Conversation buckets'));
                }
            })
            .catch(error => {
                if (!requestIsCurrent(request) || isAbortedRequest(error)) {
                    return;
                }

                console.error('Unable to load older conversation messages', error);
                setLoadMoreError(error);
            })
            .finally(() => {
                if (!requestIsCurrent(request)) {
                    return;
                }

                setIsLoadingMore(false);
                finishRequest(request);
            });
    }, [ conversationId, conversationProjectId, hasNextPage ]);

    const loadConversation = (quietly = false, initialNavigation = false) => {
        if (activeRequest.current) {
            if (!initialNavigation && activeRequest.current.initialInboxReadsId) {
                completeInitialInboxMount?.(activeRequest.current.initialInboxReadsId, true);
            }
            if (quietly) {
                queuedQuietRefresh.current = true;
                return;
            }

            activeRequest.current.controller.abort();
            activeRequest.current = null;
        }

        const controller = new AbortController();
        const request = {
            controller,
            conversationId,
            generation: ++requestGeneration.current,
        };
        request.initialInboxReadsId = initialNavigation ? initialInboxReadsId : null;
        const initialLoad = !quietly || readyConversationId !== conversationId;
        activeRequest.current = request;
        setLoadError(null);

        if (initialLoad) {
            setReadyConversationId(null);
            setBuckets([]);
            setIsLoading(true);
            setIsRefreshing(false);
            setIsLoadingMore(false);
            setLoadMoreError(null);
            setHasNextPage(true);
        } else {
            setIsRefreshing(true);
        }

        setIsMainVisible(true);

        let initialFailed = false;
        const initialId = initialNavigation ? initialInboxReadsId : null;
        fetchInitialConversationBuckets({
            conversationId,
            projectId,
            fetchConversation: (id, scope, options) => fetchConversationRef.current(id, scope, {...options, initialInboxRead: initialNavigation}),
            fetchBucketList: (id, params, scope, options) => fetchBucketListRef.current(id, params, scope, {...options, initialInboxRead: initialNavigation}),
            signal: controller.signal,
            isCurrent: () => requestIsCurrent(request),
            onConversation: nextConversation => {
                setConversationData(conversationData => ({
                    ...conversationData,
                    [nextConversation.id]: nextConversation,
                }));
            },
        })
            .then(result => {
                if (result && requestIsCurrent(request) && initialLoad) {
                    setHasNextPage(result.hasNextPage);
                    setReadyConversationId(conversationId);
                }
            })
            .catch(error => {
                initialFailed = true;
                if (!requestIsCurrent(request) || isAbortedRequest(error)) {
                    return;
                }

                if ([401,403,404].includes(error.status)) {
                    setReadyConversationId(null); setBuckets([]);
                    setConversationData(current => {const next = {...current}; delete next[conversationId]; return next;});
                } else console.error('Unable to load conversation', error);
                setLoadError({ conversationId, error });
            })
            .finally(() => {
                if (!requestIsCurrent(request)) {
                    return;
                }

                if (initialId) completeInitialInboxMount?.(initialId, initialFailed);
                setIsLoading(false);
                setIsRefreshing(false);
                finishRequest(request);
            });
    };

    loadConversationRef.current = loadConversation;

    useEffect(() => {
        // The retained provider can render the outgoing conversation once while
        // Chat's route effect activates the new explicit conversation.
        if (initialInboxReadsId && initialInboxConversationId !== conversationId) return;
        loadConversationRef.current(false, true);

        return () => {
            requestGeneration.current += 1;
            activeRequest.current?.controller.abort();
            activeRequest.current = null;
            queuedQuietRefresh.current = false;
            // StrictMode immediately installs a replacement request for this same
            // envelope. A real unmount/navigation has no such committed setup.
            queueMicrotask(() => {
                if (initialInboxReadsId && activeRequest.current?.initialInboxReadsId !== initialInboxReadsId) {
                    completeInitialInboxMount?.(initialInboxReadsId, true);
                }
            });
        };
    }, [ conversationId, initialInboxReadsId, initialInboxConversationId ]);

    useEffect(() => {
        if (lastConnected) {
            loadConversationRef.current(true);
        }
    }, [ lastConnected ]);

    useEffect(() => {
        const unavailable = event => {
            if (event.detail.conversationId !== conversationId) return;
            requestGeneration.current += 1;
            activeRequest.current?.controller.abort(); activeRequest.current = null;
            queuedQuietRefresh.current = false;
            setReadyConversationId(null); setBuckets([]);
            setIsLoading(false); setIsRefreshing(false);
            setLoadError({conversationId, error: event.detail.error});
        };
        window.addEventListener('h2h:ticket-unavailable', unavailable);
        return () => window.removeEventListener('h2h:ticket-unavailable', unavailable);
    }, [conversationId]);

    const isConversationReady = readyConversationId === conversationId;

    return {
        isConversationReady,
        isLoading,
        isLoadingMore,
        isRefreshing,
        hasNextPage,
        loadError: loadError?.conversationId === conversationId ? loadError.error : null,
        loadMoreError,
        loadOlderBuckets,
        retryConversationLoad: () => loadConversationRef.current(false),
        refreshConversation: () => loadConversationRef.current(true),
    };
}

export default useConversationLoading;
