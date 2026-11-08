import {ChatContext} from '../contexts/ChatContext';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
    nextConversationPageFilter,
    appendConversationPage,
    hasNextConversationPage,
    isAbortedConversationRequest,
    refreshConversationPages,
} from '../components/conversationListPagination';
import { busyWait, isBusy as busyError } from '../utils/busy';

function useConversationList({
    conversationLists,
    setConversationLists,
    fetchConversationList,
    inboxDataVersion,
    filter,
    listKey,
}) {
    const {initialInboxListId} = useContext(ChatContext);
    const [ isInitialLoading, setIsInitialLoading ] = useState(false);
    const [ isRefreshing, setIsRefreshing ] = useState(false);
    const [ isLoadingMore, setIsLoadingMore ] = useState(false);
    const [ hasNextPage, setHasNextPage ] = useState(false);
    const [ refreshError, setRefreshError ] = useState(null);
    const [ loadMoreError, setLoadMoreError ] = useState(null);
    const [ isBusy, setIsBusy ] = useState(false);
    const busyRetry = useRef(null);
    const loadMoreRef = useRef(null);
    const fetchConversationListRef = useRef(fetchConversationList);
    const conversationListsRef = useRef(conversationLists);
    const listRequestScope = useRef(0);
    const activeRequest = useRef(null);
    const queuedRefreshScope = useRef(null);
    const startRefreshRef = useRef(null);
    const nextPage = useRef(1);
    const refreshVersion = useRef(inboxDataVersion);

    fetchConversationListRef.current = fetchConversationList;
    conversationListsRef.current = conversationLists;

    const abortActiveRequest = useCallback(() => {
        activeRequest.current?.controller.abort();
        activeRequest.current = null;
    }, []);

    const cancelBusyRetry = useCallback(() => {
        clearTimeout(busyRetry.current);
        busyRetry.current = null;
    }, []);

    // Keep what is on screen and try the same read again while this list is still current.
    const retryWhenFree = useCallback((scope, error, retry) => {
        cancelBusyRetry();
        setIsBusy(true);
        busyRetry.current = setTimeout(() => {
            busyRetry.current = null;
            if (scope === listRequestScope.current) retry(scope);
        }, busyWait(error));
    }, [ cancelBusyRetry ]);

    const startRefresh = useCallback((scope, initialInboxListRead = false) => {
        if (scope !== listRequestScope.current) {
            return;
        }

        if (activeRequest.current) {
            queuedRefreshScope.current = scope;
            return;
        }

        const existingConversations = conversationListsRef.current[listKey] || [];
        const controller = new AbortController();
        const request = { controller, scope };
        activeRequest.current = request;
        cancelBusyRetry();
        setRefreshError(null);
        setLoadMoreError(null);

        if (existingConversations.length === 0) {
            setIsInitialLoading(true);
        } else {
            setIsRefreshing(true);
        }

        refreshConversationPages({
            fetchPage: fetchConversationListRef.current,
            filter,
            loadedCount: existingConversations.length,
            initialInboxListRead,
            signal: controller.signal,
            isCurrent: () => activeRequest.current === request && scope === listRequestScope.current,
        })
            .then(refreshed => {
                if (!refreshed || activeRequest.current !== request || scope !== listRequestScope.current) {
                    return;
                }

                nextPage.current = refreshed.nextPage;
                setIsBusy(false);
                setHasNextPage(refreshed.hasNextPage);
                setConversationLists(lists => ({
                    ...lists,
                    [listKey]: refreshed.conversations,
                }));
            })
            .catch(error => {
                if (activeRequest.current !== request || scope !== listRequestScope.current || isAbortedConversationRequest(error)) {
                    return;
                }

                if (busyError(error)) {
                    retryWhenFree(scope, error, retryScope => startRefreshRef.current(retryScope));
                    return;
                }

                console.error('Unable to load conversations', error);
                setIsBusy(false);
                setRefreshError(error);
            })
            .finally(() => {
                if (activeRequest.current !== request || scope !== listRequestScope.current) {
                    return;
                }

                activeRequest.current = null;
                setIsInitialLoading(false);
                setIsRefreshing(false);

                if (queuedRefreshScope.current === scope) {
                    queuedRefreshScope.current = null;
                    startRefreshRef.current(scope);
                }
            });
    }, [ cancelBusyRetry, filter, listKey, retryWhenFree, setConversationLists ]);

    startRefreshRef.current = startRefresh;

    useEffect(() => {
        const scope = ++listRequestScope.current;
        abortActiveRequest();
        queuedRefreshScope.current = null;
        setIsInitialLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
        setHasNextPage(false);
        setRefreshError(null);
        setLoadMoreError(null);
        cancelBusyRetry();
        setIsBusy(false);
        startRefresh(scope, true);

        return () => {
            if (scope === listRequestScope.current) {
                listRequestScope.current += 1;
                queuedRefreshScope.current = null;
                abortActiveRequest();
                cancelBusyRetry();
            }
        };
    }, [ abortActiveRequest, cancelBusyRetry, listKey, startRefresh, initialInboxListId ]);

    useEffect(() => {
        if (refreshVersion.current === inboxDataVersion) {
            return;
        }

        refreshVersion.current = inboxDataVersion;
        startRefresh(listRequestScope.current);
    }, [ inboxDataVersion, startRefresh ]);

    const loadMore = useCallback(() => {
        const scope = listRequestScope.current;
        const currentList = conversationListsRef.current[listKey] || [];
        const lastConversation = currentList[currentList.length - 1];

        if (activeRequest.current || !hasNextPage || !lastConversation) {
            return;
        }

        const controller = new AbortController();
        const request = { controller, scope };
        activeRequest.current = request;
        cancelBusyRetry();
        setLoadMoreError(null);
        setIsLoadingMore(true);

        fetchConversationListRef.current(nextConversationPageFilter(filter, lastConversation, nextPage.current), { signal: controller.signal })
            .then(result => {
                if (activeRequest.current !== request || scope !== listRequestScope.current) {
                    return;
                }

                nextPage.current = Number(result.meta.pagination.current_page) + 1;
                setIsBusy(false);
                setHasNextPage(hasNextConversationPage(result));
                setConversationLists(lists => ({
                    ...lists,
                    [listKey]: appendConversationPage(lists[listKey] || [], result),
                }));
            })
            .catch(error => {
                if (activeRequest.current !== request || scope !== listRequestScope.current || isAbortedConversationRequest(error)) {
                    return;
                }

                if (busyError(error)) {
                    retryWhenFree(scope, error, () => loadMoreRef.current());
                    return;
                }

                console.error('Unable to load more conversations', error);
                setIsBusy(false);
                setLoadMoreError(error);
            })
            .finally(() => {
                if (activeRequest.current !== request || scope !== listRequestScope.current) {
                    return;
                }

                activeRequest.current = null;
                setIsLoadingMore(false);

                if (queuedRefreshScope.current === scope) {
                    queuedRefreshScope.current = null;
                    startRefreshRef.current(scope);
                }
            });
    }, [ cancelBusyRetry, filter, hasNextPage, listKey, retryWhenFree, setConversationLists ]);

    loadMoreRef.current = loadMore;

    return {
        conversations: conversationLists[listKey] || [],
        hasNextPage,
        isBusy,
        isInitialLoading,
        isLoadingMore,
        isRefreshing,
        loadMore,
        loadMoreError,
        refreshError,
        retryRefresh: () => startRefresh(listRequestScope.current),
    };
}

export default useConversationList;
