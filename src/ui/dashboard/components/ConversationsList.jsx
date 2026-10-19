import React, { useCallback, useContext, useMemo, useEffect, useState } from 'react';
import TicketViews from './tickets/TicketViews';
import TicketBulkActions from './tickets/TicketBulkActions';
import ProblemBulkLink from './tickets/ProblemBulkLink';
import BulkMacros from './macros/BulkMacros';
import CreateEmailTicket from './CreateEmailTicket';
import {Link} from '@tanstack/react-router';
import ConversationItem from "./ConversationItem";
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { ChatContext } from "../contexts/ChatContext";
import { useNavigate } from '@tanstack/react-router';
import { useDashboardSettings, useDashboardLocation } from '../../native/dashboard-state';
import InboxTagFilter from './InboxTagFilter';
import InboxSearch from './InboxSearch';
import InboxViews from './InboxViews';
import ConversationsFilter from './ConversationsFilter';
import InboxStart from './InboxStart';
import { InboxTray } from '../../native/drawings';
import { inboxViewFilter, inboxViewPhrase, normalizeInboxView } from './inboxViewDefinitions';
import useConversationList from '../hooks/useConversationList';
import useScrollEdge from '../hooks/useScrollEdge';
import useLiveInboxLocation from '../hooks/useLiveInboxLocation';

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
    } = useContext(ChatContext);
    const settings = useDashboardSettings();
    const searchParams = useDashboardLocation().search;
    // The list shows what the loader finished; actions start from the router's live location so a quick second one keeps `q` and `tag`.
    const liveSearch = useLiveInboxLocation().search;
    const navigate = useNavigate();
    const selectedView = normalizeInboxView(searchParams.view, inboxViewCounts);
    const searchQuery = searchParams.q == null ? '' : String(searchParams.q);
    const filter = useMemo(() => ({...inboxViewFilter(selectedView, searchQuery, searchParams.assigned_to, searchParams.search_scope),...(searchParams.tag?{tag:String(searchParams.tag)}:{}),...(['only','include'].includes(searchParams.snoozed)?{snoozed:searchParams.snoozed}:{})}), [ selectedView, searchQuery, searchParams.tag, searchParams.assigned_to, searchParams.search_scope, searchParams.snoozed ]);
    const projectId = settings.isGlobalInbox ? null : settings.project?.id;
    const ticketQueue = projectId && !settings.project?.is_demo;
    const [selected, setSelected] = useState({}), [selecting, setSelecting] = useState(false);
    const [creatingTicket,setCreatingTicket] = useState(false);
    const queueFilter = useMemo(() => ticketQueue && (searchParams.saved_view || searchParams.filters)
        ? { ...(['only','include'].includes(searchParams.snoozed)?{snoozed:searchParams.snoozed}:{}), ...(searchQuery.trim() ? { q: searchQuery.trim(), search_scope: searchParams.search_scope || 'all' } : {}), ...(searchParams.tag ? { tag: String(searchParams.tag) } : {}), ...(searchParams.saved_view ? { saved_view: String(searchParams.saved_view) } : { filters: typeof searchParams.filters === 'string' ? searchParams.filters : JSON.stringify(searchParams.filters), sort: typeof searchParams.sort === 'string' ? searchParams.sort : JSON.stringify(searchParams.sort || []) }) }
        : filter, [ticketQueue, searchParams.saved_view, searchParams.filters, searchParams.sort, searchParams.snoozed, filter]);
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

    const handleSearch = query => {
        navigate({ search: { ...liveSearch, view: normalizeInboxView(liveSearch.view, inboxViewCounts), q: query.trim() || undefined } });
    };

    return (
        <div className={ `sidebar conversation-inbox px-4 py-3${isScrolled ? ' is-scrolled' : ''}` } aria-hidden={ hideBehindConversation ? 'true' : undefined } inert={ hideBehindConversation || undefined }>
            <InboxViews />
            <div className="conversation-inbox-header">
                {/* Follow the URL immediately, including Back before a read settles.
                    A completed view read must not overwrite newer search typing. */}
                <InboxSearch query={ liveSearch.q == null ? '' : String(liveSearch.q) } viewPhrase={ inboxViewPhrase(selectedView) } onSearch={ handleSearch } /><InboxTagFilter projectId={settings.isGlobalInbox?null:settings.project?.id} value={String(searchParams.tag||'')} onChange={tag=>navigate({search:{...liveSearch,tag:tag||undefined}})}/>
                <ConversationsFilter assignment={ filter.assigned_to } searchScope={ filter.search_scope || searchParams.search_scope || 'all' } searching={ Boolean(searchQuery.trim()) } onChange={ changes => navigate({search:{...liveSearch,saved_view:undefined,filters:undefined,sort:undefined,...changes}}) } />
            </div>
            {ticketQueue && <>
                <div className="ticket-queue-actions"><button type="button" className="btn btn-sm btn-link" onClick={()=>setCreatingTicket(true)}>New ticket</button><Link to={`/projects/${projectId}/suspended`} className="btn btn-sm btn-link">Suspended</Link></div>
                {creatingTicket && <CreateEmailTicket projectId={projectId} onHide={()=>setCreatingTicket(false)} onCreated={conversation=>{refreshInboxData();if(conversation?.id)navigate({to:`/projects/${projectId}/conversations/${conversation.id}`});}}/>}
                <TicketViews key={projectId} projectId={projectId} currentAgentId={currentAgent.id}/>
                <div className="ticket-queue-actions"><button type="button" className="btn btn-sm btn-link" onClick={() => { setSelecting(value => !value); setSelected({}); }}>{selecting ? 'Done selecting' : 'Select tickets'}</button>{selecting && <button type="button" className="btn btn-sm btn-link" onClick={() => setSelected(Object.fromEntries(conversations.slice(0, 100).map(item => [item.id, { id: item.id, subject: item.subject, ticket_version: item.ticket_version }])))}>Select loaded tickets</button>}</div>
                {selecting && Object.keys(selected).length > 0 && <><TicketBulkActions key={projectId} projectId={projectId} selected={Object.values(selected)} onClear={() => setSelected({})} onApplied={refreshInboxData}/><ProblemBulkLink projectId={projectId} selectedIds={Object.values(selected).map(ticket=>ticket.id)} onApplied={refreshInboxData}/><BulkMacros projectId={projectId} selectedTickets={Object.values(selected).map(ticket=>({id:ticket.id,expected_version:ticket.ticket_version}))} onApplied={refreshInboxData}/></>}
            </>}
            <div className="conversation-list-items" ref={ setListRefs }>
                { conversations.map(conversation => selecting && ticketQueue ? <div className="ticket-bulk-row" key={conversation.id}><input className="form-check-input" type="checkbox" aria-label={`Select ticket ${conversation.subject || conversation.contact?.display_name || conversation.id}`} checked={Boolean(selected[conversation.id])} disabled={!selected[conversation.id] && Object.keys(selected).length >= 100} onChange={event => { const checked = event.target.checked; setSelected(current => { const next = { ...current }; if (checked) next[conversation.id] = { id: conversation.id, subject: conversation.subject, ticket_version: conversation.ticket_version }; else delete next[conversation.id]; return next; }); }}/><ConversationItem conversation={conversation}/></div> : <ConversationItem key={conversation.id} conversation={conversation}/>) }
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
