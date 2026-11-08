import { useEffect, useRef, useState } from 'react';
import { mergeMessage, mergeBucketMessage } from '../utils/transcriptMessages';
import { busyWait, isBusy } from '../utils/busy';

export default function useTranscriptEvents({
    buckets, setBuckets, activeConversationId, activeConversationIdRef, fetchBucket, updateBucket,
    queueUnreadMessages, refreshInboxData, updateInboxMessagePreview,
}) {
    const bucketsRef = useRef(buckets);
    bucketsRef.current = buckets;
    const requests = useRef(new Map());
    const previousConversationId = useRef(activeConversationId);
    const [ transcriptError, setTranscriptError ] = useState(null);

    const clearPendingRequests = () => {
        requests.current.forEach(request => request.controller?.abort());
        requests.current.clear();
    };

    // The ref filters socket events immediately. The state value additionally lets us
    // cancel in-flight work as soon as the rendered conversation changes.
    useEffect(() => {
        if (previousConversationId.current === activeConversationId) return;

        previousConversationId.current = activeConversationId;
        clearPendingRequests();
        setTranscriptError(null);
    }, [ activeConversationId ]);

    useEffect(() => () => clearPendingRequests(), []);

    const isCurrentRequest = request => (
        requests.current.get(request.key) === request
        && request.conversationId === activeConversationIdRef.current
    );

    const clearErrorWhenRecovered = conversationId => {
        setTranscriptError(current => {
            if (current?.conversationId !== conversationId) return current;

            const stillFailed = Array.from(requests.current.values()).some(request => (
                request.conversationId === conversationId && request.failed
            ));

            return stillFailed ? current : null;
        });
    };

    const loadPendingMessages = request => {
        if (request.loading || !isCurrentRequest(request)) return;

        const controller = new AbortController();
        request.controller = controller;
        request.loading = true;
        request.failed = false;

        fetchBucket(request.conversationId, { id: request.bucketId }, undefined, request.projectId, {
            signal: controller.signal,
        }).then(result => {
            if (controller.signal.aborted || !isCurrentRequest(request)) return;

            request.loading = false;
            requests.current.delete(request.key);
            updateBucket(request.bucketId, {
                ...result.data,
                messages: request.messages.reduce(mergeMessage, result.data.messages || []),
            });
            clearErrorWhenRecovered(request.conversationId);
        }).catch(error => {
            if (controller.signal.aborted || !isCurrentRequest(request)) return;

            // Keep the real socket messages in this request so a later event or an
            // explicit retry can merge them into the fetched bucket history.
            request.loading = false;
            request.failed = true;
            request.error = error;
            request.controller = null;
            // A busy database: say so and read the same messages again after Retry-After while this conversation is open.
            if (isBusy(error)) {
                setTranscriptError({ conversationId: request.conversationId, error, busy: true });
                setTimeout(() => { if (request.failed && !request.loading && isCurrentRequest(request)) loadPendingMessages(request); }, busyWait(error));
                return;
            }
            console.error('Unable to load updated conversation messages', error);
            setTranscriptError({ conversationId: request.conversationId, error });
        });
    };

    const retryTranscriptMessages = () => {
        const conversationId = activeConversationIdRef.current;
        const failedRequests = Array.from(requests.current.values()).filter(request => (
            request.conversationId === conversationId && request.failed && !request.loading
        ));

        if (failedRequests.length === 0) return;

        setTranscriptError(null);
        failedRequests.forEach(loadPendingMessages);
    };

    const handleMessageEvent = (message, projectId) => {
        refreshInboxData();
        if (message.conversation_id !== activeConversationIdRef.current) return;

        const key = `${projectId}:${message.conversation_id}:${message.bucket_id}`;
        let pending = requests.current.get(key);

        if (bucketsRef.current.some(bucket => bucket.id === message.bucket_id)) {
            if (pending) {
                pending.controller?.abort();
                requests.current.delete(key);
            }

            const messages = pending ? mergeMessage(pending.messages, message) : [message];
            setBuckets(current => messages.reduce(mergeBucketMessage, current));
            clearErrorWhenRecovered(message.conversation_id);
        } else {
            if (!pending) {
                pending = {
                    key,
                    bucketId: message.bucket_id,
                    conversationId: message.conversation_id,
                    projectId,
                    messages: [message],
                    controller: null,
                    loading: false,
                    failed: false,
                };
                requests.current.set(key, pending);
            } else {
                pending.messages = mergeMessage(pending.messages, message);
            }

            // A real follow-up event gets one automatic retry after a failed read.
            // The loading flag keeps concurrent socket events from starting duplicates.
            loadPendingMessages(pending);
        }

        queueUnreadMessages([message], projectId);
    };

    const handleMessageUpdateEvent = message => {
        updateInboxMessagePreview(message);
        if (message.conversation_id && message.conversation_id !== activeConversationIdRef.current) return;
        // Updates can arrive while the first bucket request is still in flight.
        requests.current.forEach(request => {
            if (request.messages.some(item => item.id === message.id)) {
                request.messages = mergeMessage(request.messages, message);
            }
        });
        setBuckets(current => mergeBucketMessage(current, message));
    };

    return {
        handleMessageEvent,
        handleMessageUpdateEvent,
        transcriptError,
        retryTranscriptMessages,
    };
}
