import { ConversationSuggestionsProvider } from '../contexts/ConversationSuggestionsContext';
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Api from "../api";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import ConversationHeader from "./ConversationHeader";
import EmailFollowups from './EmailFollowups';
import ConversationForm from "./ConversationForm";
import PropTypes from "prop-types";
import { ChatContext } from "../contexts/ChatContext";
import ScrollToBottom from 'react-scroll-to-bottom';
import ConversationAssistant from "./ConversationAssistant";
import { v4 as uuidv4 } from 'uuid';
import useConversationAssistant from "../hooks/useConversationAssistant";
import useConversationLoading from '../hooks/useConversationLoading';
import ConversationBody from "./ConversationBody";

import '../styles/components/Conversation.scss';
import NoteModal from "./NoteModal";
import { useUnsavedChanges } from '../../native/NavigationGuard';
import { useDashboardSettings } from '../../native/dashboard-state';
import { NotesOnlyComposer, useCan } from './ConversationAccess';
import ConversationCollaboration from './collaboration/ConversationCollaboration';
import { CollaborationProvider } from './collaboration/useCollaboration';
import { HandleTimerProvider } from './tickets/useHandleTimer';
import TicketActionDialogs from './composer/TicketActionDialogs';
import {nativeRequest} from '../../native/transport';
import {mergeReferences} from '../../native/knowledge-references/reference-text';

function Conversation({ projectId, conversationId, conversation, buckets }) {
    const {
        currentAgent,
        setIsMainVisible,
        setBuckets,
        setConversationData,
        sendAction,
        fetchConversation,
        fetchBucketList,
        updateBucket,
        sendPluginEvent,
        lastConnected,
        socketEvent,
        sendSocket,
        transcriptError,
        retryTranscriptMessages,
        resolutionErrors,
    } = useContext(ChatContext);
    const assistant = useConversationAssistant();
    const settings = useDashboardSettings();
    const [ isSending, setIsSending ] = useState(false);
    const [ atTop, setAtTop ] = useState(true);
    const [ files, setFiles ] = useState([]);
    const [ content, setContent ] = useState('');
    const [knowledgeReferences,setKnowledgeReferences] = useState([]);
    const [ draftOrigin, setDraftOrigin ] = useState(null);
    const [ draftFocusRequest, setDraftFocusRequest ] = useState(null);
    const [ draftError, setDraftError ] = useState('');
    const [ escalationDraftId, setEscalationDraftId ] = useState(null);
    const [isTyping, setIsTyping] = useState(false);
    const typingTimer = useRef(null);
    useEffect(() => () => clearTimeout(typingTimer.current), []);
    const [ loadingContent, setLoadingContent ] = useState('');
    const [ isAssistantDisabled, setIsAssistantDisabled ] = useState(false);
    const [ isNoteModalVisible, setIsNoteModalVisible ] = useState(false);
    const [noteMacro, setNoteMacro] = useState(null);
    // The start menu's ticket dialogs, and a read key for the Ticket panel's records after one of them changes the ticket.
    const [ ticketDialog, setTicketDialog ] = useState(null);
    const [ panelReads, setPanelReads ] = useState(0);
    const [ panelAlert, setPanelAlert ] = useState(false);
    const { setDirty } = useUnsavedChanges();
    useEffect(() => {
        setDirty(Boolean(content.trim() || files.length || loadingContent || isSending));
    }, [content, files.length, loadingContent, isSending, setDirty]);
    const draftConversationIdRef = useRef(conversationId);
    const activeConversationIdRef = useRef(conversationId);
    const draftAdoptionRef = useRef(null);
    const draftEditVersion = useRef(0);
    // The usage of the saved public macro draft in the composer; clearing the composer discards it.
    const macroDraftUsageRef = useRef(null);

    activeConversationIdRef.current = conversationId;

    // In the global inbox the conversation dictates the project, not the page.
    const conversationProjectId = (conversation && conversation.project_id) || projectId;
    // A role without reply permission (a collaborator) gets notes and follow instead of the reply box;
    // the agent's view stays as approved.
    const canReply = useCan(conversationProjectId, 'conversations.reply'), canFollow = useCan(conversationProjectId, 'conversations.follow');
    const canManage = useCan(conversationProjectId, 'conversations.manage');
    // Ticket and workflow tools stay hidden in a demo project.
    const isDemo = Boolean((settings.projects?.[conversationProjectId] || settings.project)?.is_demo);
    const {
        hasNextPage,
        isConversationReady,
        isLoading,
        isLoadingMore,
        isRefreshing,
        loadError,
        loadMoreError,
        loadOlderBuckets,
        retryConversationLoad,
        refreshConversation,
    } = useConversationLoading({
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
    });
    const applyMacroDraft = (text, metadata) => {
        if (metadata.reply_type === 'note') { setNoteMacro({content:text,media:metadata.media || []}); setIsNoteModalVisible(true); }
        else {
            macroDraftUsageRef.current = metadata.usage_id || null;
            if (metadata.media?.length) setFiles(current => [...current,...metadata.media.filter(file=>!current.some(existing=>existing.id===file.id))]);
        }
        refreshConversation();
    };
    const visibleTranscriptError = transcriptError?.conversationId === conversationId;
    const isComposerEnabled = isConversationReady && buckets.length > 0 && !isLoading && !isSending && !conversation?.merged_into;
    const cancelDraftAdoption = () => {
        if (draftAdoptionRef.current) {
            draftAdoptionRef.current = null;
            setIsSending(false);
        }
    };

    const handleSendFile = selectedFiles => {
        if (!selectedFiles?.length) return;
        cancelDraftAdoption();
        setDraftError('');
        const uploadConversationId = conversationId;
        setIsSending(true);

        const params = new FormData();
        params.append('file', selectedFiles[0]);
        params.append('conversation_id', conversationId);

        Api.create(`/projects/${ conversationProjectId }/media`, params)
            .then(data => {
                if (activeConversationIdRef.current === uploadConversationId) {
                    setFiles(currentFiles => [ ...currentFiles, data.data ]);
                    setIsSending(false);
                }
            })
            .catch(error => {
                if (activeConversationIdRef.current === uploadConversationId) {
                    setDraftError(`Attachment “${selectedFiles[0].name}” wasn’t added: ${error.message || 'the upload failed'}. Select it again to retry.`);
                    setIsSending(false);
                }
            });
    };

    const handleRemoveFile = file => {
        cancelDraftAdoption();
        setFiles(currentFiles => currentFiles.filter(item => item.id !== file.id));
    };

    const handleSendMessage = async (messageContent, sendAndClose = false, email) => {
        const lastBucket = buckets[buckets.length - 1];
        if (!lastBucket) {
            return Promise.reject(new Error('Conversation history is not ready.'));
        }

        setIsSending(true);
        const message = {
            content: messageContent,
            authoring: draftOrigin || {kind: 'human'},
            conversation_id: conversationId,
            media_ids: files.map(file => file.id),
            local_id: uuidv4(),
            escalation_draft_id: escalationDraftId,
            ...(email ? {email} : {}),
        };
        if (sendAndClose) {
            message.resolve = true;
        }

        try {
            await sendAction('sendMessage', message, conversationProjectId);
            setDraftError('');
            setDraftOrigin(null);
            setEscalationDraftId(null);
            setFiles([]);
            macroDraftUsageRef.current = null;
        } catch (error) { setDraftError(error.message); throw error; } finally {
            setIsSending(false);
        }
        if (sendAndClose) {
            sendPluginEvent('resolveConversation', conversation);
        }

        return Promise.resolve();
    };

    useEffect(() => {
        draftConversationIdRef.current = conversationId;
        draftEditVersion.current++;
        draftAdoptionRef.current = null;
        macroDraftUsageRef.current = null;
        setDraftError('');
        setContent('');
        setKnowledgeReferences([]);
        setDraftOrigin(null);
        setEscalationDraftId(null);
        setDraftFocusRequest(null);
        setLoadingContent('');
        setFiles([]);
        setIsSending(false);
        setIsAssistantDisabled(false);
        setIsNoteModalVisible(false);
        setNoteMacro(null);
        setTicketDialog(null);
        setPanelAlert(false);
        return () => { draftAdoptionRef.current = null; };
    }, [ conversationId ]);

    useEffect(() => {
        if (!isConversationReady) return;
        let active = true;
        const editVersion = draftEditVersion.current;
        nativeRequest(`/api/dashboard/projects/${conversationProjectId}/conversations/${conversationId}/macro-draft`)
            .then(result => {
                const draft = result.data;
                if (!active || !draft || draftEditVersion.current !== editVersion) return;
                if (draft.reply_type === 'note') setNoteMacro({content:draft.content,media:draft.media || []});
                else { macroDraftUsageRef.current = draft.usage_id; setContent(draft.content); setKnowledgeReferences(draft.references || []); setFiles(draft.media || []); }
            }).catch(error => { if (active) setDraftError(`Couldn’t load your saved macro draft: ${error.message}`); });
        return () => { active = false; };
    }, [conversationProjectId,conversationId,isConversationReady]);

    const updateDraftContent = (nextContent, attachments, origin) => {
        draftEditVersion.current++;
        setIsTyping(Boolean(nextContent)); clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setIsTyping(false), 1500);
        cancelDraftAdoption();
        draftConversationIdRef.current = conversationId;
        setContent(nextContent);
        if (origin !== undefined) setDraftOrigin(origin);
        else if (!nextContent.trim()) setDraftOrigin(null);
        if (!nextContent.trim() && macroDraftUsageRef.current) {
            const usage = macroDraftUsageRef.current;
            macroDraftUsageRef.current = null;
            nativeRequest(`/api/dashboard/projects/${conversationProjectId}/conversations/${conversationId}/macro-draft?usage_id=${encodeURIComponent(usage)}`, { method: 'DELETE' })
                .catch(error => setDraftError(`Couldn’t discard your saved macro draft: ${error.message}`));
        }
        if (Array.isArray(attachments)) {
            setFiles(currentFiles => Array.from(new Map([ ...currentFiles, ...attachments ].map(file => [ file.id, file ])).values()));
        }
    };
    const insertAssistantDraft = async (nextContent, attachments, localResult) => {
        // A handoff must land in a composer whose reply controls are available.
        // Otherwise native Tab skips its disabled tools and Send into the panel.
        if (!isComposerEnabled || activeConversationIdRef.current !== conversationId) return;
        if (draftAdoptionRef.current) return;
        setDraftError('');
        let origin;
        // Local upload ids are evidence ids, not native composer media ids.
        // Adopt the stored result before changing the draft or releasing focus.
        if (localResult) {
            const request = {};
            draftAdoptionRef.current = request;
            setIsSending(true);
            try {
                const response = await Api.create(`/projects/${conversationProjectId}/conversations/${conversationId}/delegations/${localResult.jobId}/result/draft`, {
                    proposal_id: localResult.proposalId,
                    expected_revision: conversation.revision,
                    expected_last_message_id: conversation.last_message_id,
                });
                if (activeConversationIdRef.current !== conversationId || draftAdoptionRef.current !== request) return;
                nextContent = response.data.body;
                attachments = response.data.attachments;
                origin = response.data.authoring;
            } catch (error) {
                if (activeConversationIdRef.current === conversationId && draftAdoptionRef.current === request) {
                    setDraftError(error.message || 'Could not prepare the reply attachments. Review the result before trying again.');
                }
                return;
            } finally {
                if (draftAdoptionRef.current === request) {
                    draftAdoptionRef.current = null;
                    setIsSending(false);
                }
            }
        }
        updateDraftContent(nextContent, attachments, origin);
        assistant.releaseDraft();
        setDraftFocusRequest(previous => ({ conversationId, version: (previous?.version || 0) + 1 }));
    };
    // After a start menu dialog changes the ticket, the panel reads its records again and the conversation refreshes.
    const ticketChanged = useCallback(async () => {
        setPanelReads(count => count + 1);
        await refreshConversation();
    }, [ refreshConversation ]);
    const openPanel = assistant.openPanel;
    const ticketMenu = useMemo(() => conversation && ({
        conversation,
        isDemo,
        onDialog: setTicketDialog,
        onOpenPanel: openPanel,
    }), [ conversation, isDemo, openPanel ]);
    // An escalation's customer update goes to the composer for review; a compact panel sheet steps aside for it.
    const reviewEscalationDraft = draft => {
        updateDraftContent(draft.content, [], {kind:'human'});
        setEscalationDraftId(draft.id);
        assistant.releaseDraft();
        setDraftFocusRequest(previous => ({conversationId, version: (previous?.version || 0) + 1}));
    };
    const isDraftCurrent = draftConversationIdRef.current === conversationId;
    const draftContent = isDraftCurrent ? content : '';
    const draftFiles = isDraftCurrent ? files : [];
    const draftLoadingContent = isDraftCurrent ? loadingContent : '';
    const infiniteRef = useInfiniteScroll({
        loading: isLoading || isRefreshing || isLoadingMore,
        hasNextPage: isConversationReady && hasNextPage && !loadMoreError,
        onLoadMore: loadOlderBuckets,
        scrollContainer: 'parent',
        direction: 'to-top',
    });

    if (!conversation) {
        return <div className="chat flex-column justify-content-center text-center">
            <div className="container-xxl">
                { loadError ? <p className="conversation-load-error" role="alert">
                    Couldn’t load this conversation. <button type="button" onClick={ retryConversationLoad }>Retry</button>
                </p> : <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Loading...</span>
                </div> }
            </div>
        </div>;
    }

    const messages = buckets.flatMap(bucket => bucket.messages || []);
    const presence = canFollow && <ConversationCollaboration projectId={conversationProjectId} conversationId={conversationId} currentUserId={currentAgent?.id} socketEvent={socketEvent} sendSocket={sendSocket} hasDraft={Boolean(draftContent.trim() || draftFiles.length)} isTyping={isTyping}/>;
    const noteDraft = noteMacro && !isNoteModalVisible && <p className="conversation-note-draft" role="status">
        <i className="fe fe-lock" aria-hidden="true" /> Saved internal note draft <button className="btn btn-link btn-sm" type="button" onClick={()=>setIsNoteModalVisible(true)}>Review note</button>
    </p>;

    return (
        <ConversationSuggestionsProvider
            key={ conversationId }
            conversationId={ conversationId }
            message={ draftContent }
            draftOrigin={ draftOrigin }
            disabled={ isAssistantDisabled || !isConversationReady || isLoading || isSending }
            onMessageChange={ updateDraftContent }
            onLoadingMessageChange={ nextLoadingContent => {
                draftConversationIdRef.current = conversationId;
                setLoadingContent(nextLoadingContent);
            } }>
            <CollaborationProvider projectId={ conversationProjectId } conversationId={ conversationId } socketEvent={ socketEvent }>
            <HandleTimerProvider conversation={ conversation } enabled={ canManage && !isDemo }>
            <div className="chat">
                <div className="chat-body">
                    <ConversationHeader
                        conversation={ conversation }
                        onPanelToggle={ assistant.toggle }
                        isPanelVisible={ assistant.isVisible }
                        hasPanelAlert={ panelAlert }
                        panelToggleRef={ assistant.toggleRef }
                        isLoading={ isLoading || isLoadingMore }
                        atTop={ atTop }
                    />
                    { resolutionErrors?.[conversationId] && <p className="conversation-load-error conversation-resolution-error" role="alert">{ resolutionErrors[conversationId] }</p> }

                    <EmailFollowups projectId={conversationProjectId} conversationId={conversationId}/>
                    <ScrollToBottom className="chat-content" followButtonClassName="follow-button-hide" forwardRef={ infiniteRef }>
                        { loadError && <p className="conversation-load-error px-2 py-2" role="alert">
                            Couldn’t refresh this conversation. <button type="button" onClick={ retryConversationLoad }>Retry</button>
                        </p> }
                        { visibleTranscriptError && <p className="conversation-load-error px-2 py-2" role="alert">
                            Couldn’t load newer messages. <button type="button" onClick={ () => retryTranscriptMessages() }>Retry</button>
                        </p> }
                        { isLoading && <div className="text-center px-2 py-2" role="status">Loading conversation...</div> }
                        <ConversationBody conversation={ conversation } buckets={ buckets } setAtTop={ setAtTop } />
                        { loadMoreError && <p className="conversation-load-error px-2 py-2" role="alert">
                            Couldn’t load older messages. <button type="button" onClick={ loadOlderBuckets }>Retry</button>
                        </p> }
                    </ScrollToBottom>

                    { conversation.merged_into ? <p className="conversation-merged-notice" role="status">This ticket was merged. <a href={`/conversations/${conversation.merged_into}`}>Open the surviving ticket</a>.</p>
                        : canReply ? <ConversationForm
                            key={ conversationId }
                            content={ draftContent }
                            audienceRevision={JSON.stringify([conversation.contact_id,conversation.contact?.email,conversation.participants?.map(participant => [participant.id,participant.email,participant.provided_email])])}
                            references={knowledgeReferences}
                            onReferencesChange={incoming => setKnowledgeReferences(current => mergeReferences(current,incoming))}
                            focusRequest={ draftFocusRequest?.conversationId === conversationId ? draftFocusRequest.version : 0 }
                            conversationId={ conversationId }
                            projectId={ conversationProjectId }
                            loadingContent={ draftLoadingContent }
                            onSendMessage={ handleSendMessage }
                            onFileSelect={ handleSendFile }
                            onFileRemove={ handleRemoveFile }
                            onAddNote={ () => setIsNoteModalVisible(true) }
                            onContentChange={ updateDraftContent }
                            onMacroApplied={applyMacroDraft}
                            onAssistantDisabledChange={ setIsAssistantDisabled }
                            files={ draftFiles }
                            isResolved={ Boolean(conversation.resolved_at) }
                            finalReason={ conversation.status_category === 'closed' ? 'This ticket is closed and final, so it takes no more replies. A customer reply opens a new ticket.' : null }
                            isEnabled={ isComposerEnabled }
                            presence={ presence }
                            noteDraft={ noteDraft }
                            draftError={ draftError }
                            ticketMenu={ ticketMenu }
                        /> : <NotesOnlyComposer onAddNote={ () => setIsNoteModalVisible(true) } presence={ presence } noteDraft={ noteDraft } draftError={ draftError } ticketMenu={ ticketMenu } /> }
                </div>

                { assistant.isVisible && <button type="button" className="conversation-assistant-backdrop" onClick={ assistant.close } aria-label="Close conversation panel overlay" tabIndex={ -1 } /> }
                <ConversationAssistant
                    closeButtonRef={ assistant.closeRef }
                    draftError={ draftError }
                    isDraftDisabled={ !isComposerEnabled }
                    conversation={ conversation }
                    conversationId={ conversationId }
                    isVisible={ assistant.isVisible }
                    onClose={ assistant.close }
                    onInsertDraft={ insertAssistantDraft }
                    onConversationChanged={ refreshConversation }
                    onTicketChanged={ ticketChanged }
                    onAlertChange={ setPanelAlert }
                    onReviewEscalationDraft={ canReply ? reviewEscalationDraft : undefined }
                    panelReads={ panelReads }
                    liveKey={ socketEvent?.kind === 'escalation' ? socketEvent : lastConnected }
                    panelRef={ assistant.panelRef }
                    requestedTab={ assistant.requestedTab }
                    requestedSection={ assistant.requestedSection }
                    requestedTabVersion={ assistant.requestedTabVersion }
                />

                <TicketActionDialogs
                    dialog={ ticketDialog }
                    onHide={ () => setTicketDialog(null) }
                    conversation={ conversation }
                    messages={ messages }
                    onChanged={ ticketChanged }
                    onEscalated={ () => { openPanel('details', 'escalations'); return ticketChanged(); } }
                />
                { isNoteModalVisible && <NoteModal conversation={ conversation } initialContent={noteMacro?.content || ''} initialMedia={noteMacro?.media || []} onHide={ () => {setIsNoteModalVisible(false);setNoteMacro(null);} } /> }
            </div>
            </HandleTimerProvider>
            </CollaborationProvider>
        </ConversationSuggestionsProvider>
    );
}

Conversation.propTypes = {
    conversationId: PropTypes.string,
    projectId: PropTypes.string,
    conversation: PropTypes.object,
    buckets: PropTypes.array,
};

export default Conversation;
