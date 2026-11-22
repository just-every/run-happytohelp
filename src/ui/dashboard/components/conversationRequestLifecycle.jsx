function hasNextPage(result, resourceName) {
    const pagination = result?.meta?.pagination;
    const currentPage = Number(pagination?.current_page);
    const totalPages = Number(pagination?.total_pages);

    if (!Number.isInteger(currentPage) || !Number.isInteger(totalPages) || currentPage < 1 || totalPages < currentPage) {
        throw new Error(`${resourceName} response did not include valid pagination`);
    }

    return currentPage < totalPages;
}

function isAbortedRequest(error) {
    return error?.name === 'AbortError';
}

// A refresh can start before a write and finish after its acknowledgement.
function isOlderConversationSnapshot(incoming, current) {
    return incoming.ticket_version < current?.ticket_version || (
        incoming.ticket_version === current?.ticket_version && incoming.revision < current?.revision
    );
}

async function fetchInitialConversationBuckets({
    conversationId,
    projectId,
    fetchConversation,
    fetchBucketList,
    signal,
    isCurrent,
    onConversation,
}) {
    // A project URL already supplies both request scopes. Fetch history and
    // conversation metadata together instead of adding another network round trip.
    const conversationRequest = fetchConversation(conversationId, projectId, { signal });
    const bucketsRequest = projectId ? fetchBucketList(
        conversationId, { newest_with_messages: 1 }, projectId, { signal },
    ) : null;
    const [conversationResult, initialBuckets] = await Promise.all([conversationRequest, bucketsRequest]);
    if (!isCurrent()) return null;
    onConversation(conversationResult.data);
    const bucketResult = initialBuckets || await fetchBucketList(
        conversationId, { newest_with_messages: 1 }, conversationResult.data.project_id, { signal },
    );

    if (!isCurrent()) {
        return null;
    }

    return {
        conversation: conversationResult.data,
        hasNextPage: hasNextPage(bucketResult, 'Conversation buckets'),
    };
}

export {
    fetchInitialConversationBuckets,
    hasNextPage,
    isAbortedRequest,
    isOlderConversationSnapshot,
};
