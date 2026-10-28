import React, { useCallback, useContext, useMemo, useEffect, useState } from 'react';
import TicketBulkActions from './tickets/TicketBulkActions';
import CreateEmailTicket from './CreateEmailTicket';
import ConversationItem, { conversationNameId } from "./ConversationItem";
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { ChatContext } from "../contexts/ChatContext";
import { useNavigate } from '@tanstack/react-router';
import { useDashboardSettings, useDashboardLocation } from '../../native/dashboard-state';
import { inboxSource, useInboxNavigation, useInboxNavigationActions } from '../../native/inbox-navigation-state';
import InboxListHeader from './InboxListHeader';
import InboxStart from './InboxStart';
import { InboxTray } from '../../native/drawings';
import { inboxPlace, inboxViewFilter, inboxViewPhrase } from './inboxViewDefinitions';
import useConversationList from '../hooks/useConversationList';
import useScrollEdge from '../hooks/useScrollEdge';
import useLiveInboxLocation from '../hooks/useLiveInboxLocation';
import { tooltip } from '../../../modules/tooltip/tooltip';

// `isFirstRun` is a new workspace's empty inbox. Its start block sits in this column on a phone (`startHere`) and in the
// main pane otherwise, so only one of them is ever on the page.
function ConversationsList({ isFirstRun = false, startHere = false, hideBehindConversation = false }) {
    const {
        conversationLists,
        setConversationLists,
        fetchConversationList,
        inboxDataVersion,
        inboxViewCounts,
        currentAgent,
        refreshInboxData,
        setIsMainVisible,
    } = useContext(ChatContext);
    const settings = useDashboardSettings();
    const searchParams = useDashboardLocation().search;
    // The list shows what the loader finished; actions start from the router's live location so a quick second one keeps `q` and `tag`.
    const liveSearch = useLiveInboxLocation().search;
    const navigate = useNavigate();
    const projectId = settings.isGlobalInbox ? null : settings.project?.id;
    const ticketQueue = Boolean(projectId) && !settings.project?.is_demo;
    const place = inboxPlace(searchParams, inboxViewCounts, ticketQueue);
    const selectedView = place.view;
    const searchQuery = searchParams.q == null ? '' : String(searchParams.q);
    const filter = useMemo(() => ({...(searchParams.company?{company:String(searchParams.company)}:{}),...inboxViewFilter(selectedView, searchQuery, searchParams.assigned_to, searchParams.search_scope),...(searchParams.tag?{tag:String(searchParams.tag)}:{}),...(['only','include'].includes(searchParams.snoozed)?{snoozed:searchParams.snoozed}:{})}), [ selectedView, searchQuery, searchParams.company, searchParams.tag, searchParams.assigned_to, searchParams.search_scope, searchParams.snoozed ]);
    const [selected, setSelected] = useState({}), [selecting, setSelecting] = useState(false);
    const [creatingTicket,setCreatingTicket] = useState(false);
    const queueFilter = useMemo(() => ticketQueue && (searchParams.saved_view || searchParams.filters)
        ? { ...(searchParams.company?{company:String(searchParams.company)}:{}), ...(['only','include'].includes(searchParams.snoozed)?{snoozed:searchParams.snoozed}:{}), ...(searchQuery.trim() ? { q: searchQuery.trim(), search_scope: searchParams.search_scope || 'all' } : {}), ...(searchParams.tag ? { tag: String(searchParams.tag) } : {}), ...(searchParams.saved_view ? { saved_view: String(searchParams.saved_view) } : { filters: typeof searchParams.filters === 'string' ? searchParams.filters : JSON.stringify(searchParams.filters), sort: typeof searchParams.sort === 'string' ? searchParams.sort : JSON.stringify(searchParams.sort || []) }) }
        : filter, [ticketQueue, searchParams.saved_view, searchParams.filters, searchParams.sort, searchParams.snoozed, searchParams.company, filter]);
    const listKey = JSON.stringify(queueFilter);
    useEffect(() => { setSelected({}); }, [listKey, projectId]);
    const {
        conversations,
        hasNextPage,
        isInitialLoading,
        isLoadingMore,
        isRefreshing,
        loadMore,
        loadMoreError,
        refreshError,
        retryRefresh,
    } = useConversationList({
        conversationLists,
        setConversationLists,
        fetchConversationList,
        inboxDataVersion,
        filter: queueFilter,
        listKey,
    });
    const [ sentryRef, { rootRef } ] = useInfiniteScroll({
        loading: isInitialLoading || isRefreshing || isLoadingMore,
        hasNextPage: hasNextPage && !refreshError && !loadMoreError && conversations.length > 0,
        onLoadMore: loadMore,
    });
    const { ref: scrollEdgeRef, isScrolled } = useScrollEdge();
    const setListRefs = useCallback(element => {
        rootRef(element);
        scrollEdgeRef(element);
    }, [ rootRef, scrollEdgeRef ]);

    const { savedViews } = useInboxNavigation(inboxSource(settings.isGlobalInbox, projectId));
    const { onViewChosen } = useInboxNavigationActions();
    // A view chosen from the phone's menu sheet shows its list, even from an open conversation.
    useEffect(() => onViewChosen(() => { if (window.matchMedia('(max-width: 1199.98px)').matches) setIsMainVisible(false); }), [ onViewChosen, setIsMainVisible ]);

    // A search keeps a view explicit (its default follows the counts); a saved view or the Snoozed place stays as it is.
    const handleSearch = (query, scope) => {
        const livePlace = inboxPlace(liveSearch, inboxViewCounts, ticketQueue);
        navigate({ search: { ...liveSearch, view: livePlace.kind === 'view' ? livePlace.view : liveSearch.view, q: query.trim() || undefined, search_scope: query.trim() && scope === 'view' ? 'view' : undefined } });
    };

    return (
        <div className={ `sidebar conversation-inbox px-4 py-3${isScrolled ? ' is-scrolled' : ''}` } aria-hidden={ hideBehindConversation ? 'true' : undefined } inert={ hideBehindConversation || undefined }>
            <InboxListHeader
                projectId={ projectId }
                companyProjectId={ settings.projects?.[projectId]?.access?.permissions?.includes('contacts.manage') ? projectId : null }
                queue={ ticketQueue }
                currentAgentId={ currentAgent.id }
                search={ searchParams }
                liveQuery={ liveSearch.q == null ? '' : String(liveSearch.q) }
                place={ place }
                counts={ inboxViewCounts }
                savedViews={ savedViews }
                query={ searchQuery.trim() }
                assignment={ filter.assigned_to }
                selecting={ selecting }
                onSelecting={ () => { setSelecting(value => !value); setSelected({}); } }
                onNewTicket={ () => setCreatingTicket(true) }
                onSearch={ handleSearch }
                onChange={ patch => navigate({ search: { ...liveSearch, ...patch } }) } />
            {creatingTicket && <CreateEmailTicket projectId={projectId} onHide={()=>setCreatingTicket(false)} onCreated={conversation=>{refreshInboxData();if(conversation?.id)navigate({to:`/projects/${conversation.project_id||projectId}/conversations/${conversation.id}`});}}/>}
            {ticketQueue && selecting && <TicketBulkActions key={projectId} projectId={projectId} loaded={conversations} selected={selected} onSelect={setSelected} onDone={() => { setSelecting(false); setSelected({}); }} onApplied={refreshInboxData}/>}
            <div className="conversation-list-items" ref={ setListRefs }>
                { conversations.map(conversation => selecting && ticketQueue ? <div className="ticket-bulk-row" key={conversation.id}><input className="form-check-input" type="checkbox" {...tooltip('Select ticket', {describedBy: conversationNameId(conversation.id)})} checked={Boolean(selected[conversation.id])} disabled={!selected[conversation.id] && Object.keys(selected).length >= 100} onChange={event => { const checked = event.target.checked; setSelected(current => { const next = { ...current }; if (checked) next[conversation.id] = { id: conversation.id, subject: conversation.subject, ticket_version: conversation.ticket_version }; else delete next[conversation.id]; return next; }); }}/><ConversationItem conversation={conversation}/></div> : <ConversationItem key={conversation.id} conversation={conversation}/>) }
                { isInitialLoading && conversations.length === 0 && <p className="text-center" role="status">Loading conversations...</p> }
                { !isInitialLoading && !refreshError && !hasNextPage && conversations.length === 0 && (
                    searchQuery.trim()
                        ? <p className="conversation-empty-state" role="status">No results for “{ searchQuery.trim() }” in { filter.search_scope === 'view' ? inboxViewPhrase(selectedView) : 'all history' }. Search matches message phrases, customer names and email addresses.</p>
                        : <>
                            { startHere
                                ? <InboxStart name={ currentAgent.name }/>
                                : <div className="conversation-empty-state">{ !isFirstRun && <InboxTray/> }<p>No conversations match this view.</p></div> }
                        </>
                ) }
                { refreshError?.status === 400 && <p className="conversation-search-notice" role="alert">{ refreshError.message }</p> }
                { refreshError && refreshError.status !== 400 && <p className="conversation-list-error" role="alert">
                    {conversations.length ? 'Couldn’t refresh conversations.' : 'Couldn’t load conversations.'}
                    <button type="button" onClick={ retryRefresh }>Retry</button>
                </p> }
                { isLoadingMore && <p className="text-center" role="status">Loading more conversations...</p> }
                { loadMoreError && conversations.length > 0 && <p className="conversation-list-error" role="alert">
                    Couldn’t load more conversations. <button type="button" onClick={ loadMore }>Retry</button>
                </p> }
                { hasNextPage && !isInitialLoading && !isRefreshing && !isLoadingMore && !refreshError && !loadMoreError && conversations.length > 0 && (
                    <div className="conversation-list-sentinel" ref={ sentryRef } aria-hidden="true" />
                ) }
            </div>
        </div>
    );
}

export default ConversationsList;
