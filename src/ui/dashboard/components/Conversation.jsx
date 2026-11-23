import { ConversationSuggestionsProvider } from '../contexts/ConversationSuggestionsContext';
import { useRouter, useRouterState } from '@tanstack/react-router';
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
import useInboxRoute from '../hooks/useInboxRoute';
import ConversationBody from "./ConversationBody";

import '../styles/components/Conversation.scss';
import NoteModal from "./NoteModal";
import { useUnsavedChanges } from '../../native/NavigationGuard';
import { useDashboardLocation, useDashboardSettings } from '../../native/dashboard-state';
import { NotesOnlyComposer, useCan } from './ConversationAccess';
import ConversationCollaboration from './collaboration/ConversationCollaboration';
import { CollaborationProvider } from './collaboration/useCollaboration';
import { HandleTimerProvider } from './tickets/useHandleTimer';
import TicketActionDialogs from './composer/TicketActionDialogs';
import {nativeRequest} from '../../native/transport';
import {mergeReferences} from '../../native/knowledge-references/reference-text';
import {clearSentReplyEdit, readSavedReplyEdit, savedReplyEditKey, writeSavedReplyEdit} from '../utils/savedReplyEdit';

// A request can outlive a ticket view, including a return through the Inbox list.
const pendingReplySends = new Map();
const pendingReplyUploads = new Map();

function mergeDraftFiles(current, additions) {
    return [...new Map([...current, ...additions].map(file => [file.id, file])).values()];
}

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
        socketConnected,
        sendSocket,
        transcriptError,
        retryTranscriptMessages,
        resolutionErrors,
    } = useContext(ChatContext);
    const assistant = useConversationAssistant();
    const settings = useDashboardSettings();
    const router = useRouter();
    const { urlConversationId } = useInboxRoute();
    const renderedPath = useDashboardLocation().pathname;
    const navigationPath = useRouterState({ select: state => state.location.pathname });
    const [ isSending, setIsSending ] = useState(false);
    const [ atTop, setAtTop ] = useState(true);
    const [ files, setFiles ] = useState([]);
    const filesRef = useRef(files);
    const setDraftFiles = nextFiles => {
        filesRef.current = nextFiles;
        setFiles(nextFiles);
    };
    const [ content, setContent ] = useState('');
    const [knowledgeReferences,setKnowledgeReferences] = useState([]);
    const [ draftOrigin, setDraftOrigin ] = useState(null);
    const [ draftFocusRequest, setDraftFocusRequest ] = useState(null);
    const [ draftError, setDraftError ] = useState('');
    const [ draftRead, setDraftRead ] = useState(null);
    const [ draftReadAttempt, setDraftReadAttempt ] = useState(null);
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
    const { setDirty } = useUnsavedChanges(true);
    useEffect(() => {
        setDirty(Boolean(content.trim() || files.length || loadingContent || isSending));
    }, [content, files.length, loadingContent, isSending, setDirty]);
    const draftConversationIdRef = useRef(conversationId);
    const activeConversationIdRef = useRef(conversationId);
    const draftAdoptionRef = useRef(null);
    const draftEditVersion = useRef(0);
    const savedReplyRef = useRef(null);
    const activeDraftViewRef = useRef(null);

    activeConversationIdRef.current = conversationId;

    // In the global inbox the conversation dictates the project, not the page.
    const conversationProjectId = (conversation && conversation.project_id) || projectId;
    const savedEditKey = savedReplyEditKey(conversationProjectId, conversationId, currentAgent?.id);
    const draftView = useMemo(() => ({key: savedEditKey}), [savedEditKey]);
    activeDraftViewRef.current = draftView;
    useEffect(() => {
        activeDraftViewRef.current = draftView;
        return () => { activeDraftViewRef.current = null; };
    }, [draftView]);
    // A role without reply permission (a collaborator) gets notes and follow instead of the reply box;
    // the agent's view stays as approved.
    const canReply = useCan(conversationProjectId, 'conversations.reply'), canFollow = useCan(conversationProjectId, 'conversations.follow');
    const canManage = useCan(conversationProjectId, 'conversations.manage');
    const isContactErased = Boolean(conversation?.contact?.is_erased || conversation?.contact?.is_erasing);
    const currentDraftRead = draftRead?.key === savedEditKey ? draftRead : null;
    const draftReadError = isContactErased ? null : currentDraftRead?.error;
    const draftLoadState = isContactErased ? null : currentDraftRead?.locked ? 'error' : currentDraftRead ? null : 'loading';
    const restoreLocalReply = (local, draft) => {
        setContent(local.content);
        setDraftFiles(local.files ?? draft?.media ?? []);
        setDraftOrigin(local.origin ?? null);
        setEscalationDraftId(local.escalationDraftId ?? null);
    };
    const restorePlainReply = () => {
        const local = readSavedReplyEdit(savedEditKey);
        if (local?.id === null || local?.discarded) restoreLocalReply(local);
    };
    const persistReply = (text, media, origin, escalation) => {
        const saved = savedReplyRef.current;
        writeSavedReplyEdit(savedEditKey, saved || text.trim() || media.length
            ? {id: null, ...saved, content: text, files: media, origin, escalationDraftId: escalation}
            : null);
    };
    const retryDraftRead = () => {
        setDraftRead(null);
        setDraftReadAttempt({key: savedEditKey});
    };
    const continueWithoutDraft = () => {
        restorePlainReply();
        setDraftRead({...currentDraftRead, locked: false});
    };
    // Ticket and workflow tools stay hidden in a demo project.
    const isDemo = Boolean((settings.projects?.[conversationProjectId] || settings.project)?.is_demo);
    const {
        hasNextPage,
        isConversationReady,
        isBusy,
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
    useEffect(() => {
        if (![401,403,404].includes(loadError?.status)) return;
        draftEditVersion.current++; draftAdoptionRef.current = null; savedReplyRef.current = null;
        writeSavedReplyEdit(savedEditKey, null);
        setContent(''); setDraftFiles([]); setLoadingContent(''); setDraftOrigin(null); setKnowledgeReferences([]);
        setDraftError(''); setDraftRead(null); setDraftFocusRequest(null); setIsTyping(false);
        setEscalationDraftId(null); setNoteMacro(null); setIsNoteModalVisible(false);
        setTicketDialog(null); setIsSending(false); setPanelAlert(false);
    }, [loadError, savedEditKey]);
    const applyMacroDraft = (text, metadata) => {
        if (metadata.reply_type === 'note') { setNoteMacro({content:text,media:metadata.media || []}); setIsNoteModalVisible(true); }
        else {
            savedReplyRef.current = metadata.usage_id ? {id: metadata.usage_id, discarded: false} : null;
            if (metadata.media?.length) setDraftFiles(mergeDraftFiles(filesRef.current, metadata.media));
        }
        refreshConversation();
    };
    const visibleTranscriptError = transcriptError?.conversationId === conversationId && !transcriptError.busy;
    const isTranscriptBusy = transcriptError?.conversationId === conversationId && Boolean(transcriptError.busy);
    const isSwitchingConversation = navigationPath !== renderedPath || urlConversationId !== conversationId;
    const isSendingReply = pendingReplySends.has(savedEditKey);
    const isComposerEnabled = !isSwitchingConversation && conversation?.id === conversationId
        && !draftLoadState && isConversationReady && buckets.length > 0 && !isLoading && !isSending && !conversation.merged_into;
    const cancelDraftAdoption = () => {
        if (draftAdoptionRef.current) {
            draftAdoptionRef.current = null;
            setIsSending(false);
        }
    };

    const handleSendFile = selectedFiles => {
        if (!selectedFiles?.length || pendingReplyUploads.has(savedEditKey)) return;
        cancelDraftAdoption();
        setDraftError('');
        setIsSending(true);

        const params = new FormData();
        params.append('file', selectedFiles[0]);
        params.append('conversation_id', conversationId);

        const upload = Api.create(`/projects/${ conversationProjectId }/media`, params)
            .then(data => {
                const local = readSavedReplyEdit(savedEditKey);
                const nextFiles = mergeDraftFiles(local?.files ?? [], [data.data]);
                // The upload can finish after the operator has opened another
                // ticket. Append to the draft it was started from.
                if (activeDraftViewRef.current === draftView) {
                    draftEditVersion.current++;
                    setDraftFiles(nextFiles);
                }
                writeSavedReplyEdit(savedEditKey, {
                    id: null, content: '', ...local, files: nextFiles,
                });
            })
            .catch(error => {
                if (activeDraftViewRef.current === draftView) {
                    setDraftError(`Attachment “${selectedFiles[0].name}” wasn’t added: ${error.message || 'the upload failed'}. Select it again to retry.`);
                }
            })
            .finally(() => {
                pendingReplyUploads.delete(savedEditKey);
                if (activeDraftViewRef.current === draftView) setIsSending(false);
            });
        persistReply(content, filesRef.current, draftOrigin, escalationDraftId);
        pendingReplyUploads.set(savedEditKey, upload);
    };

    const handleRemoveFile = file => {
        cancelDraftAdoption();
        const nextFiles = filesRef.current.filter(item => item.id !== file.id);
        draftEditVersion.current++;
        persistReply(content, nextFiles, draftOrigin, escalationDraftId);
        setDraftFiles(nextFiles);
    };

    const handleSendMessage = async (expectedConversationId, messageContent, sendAndClose = false, email) => {
        // A blocking route loader can keep the previous ticket mounted after the
        // router has selected the next one. Check the live location at dispatch.
        if (!isComposerEnabled || router.latestLocation.pathname !== renderedPath
            || expectedConversationId !== conversationId || pendingReplySends.has(savedEditKey)) {
            throw new Error('Wait for the selected conversation to load before sending.');
        }

        const sentEditVersion = draftEditVersion.current;
        const sentEdit = readSavedReplyEdit(savedEditKey);
        let settleSend;
        pendingReplySends.set(savedEditKey, new Promise(resolve => { settleSend = resolve; }));
        setIsSending(true);
        const message = {
            content: messageContent,
            authoring: draftOrigin || {kind: 'human'},
            conversation_id: conversationId,
            expectedConversationId,
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
            // An acknowledgement owns only the draft it sent. Edits made while
            // the request was pending belong to the next reply.
            clearSentReplyEdit(savedEditKey, sentEdit);
            if (activeDraftViewRef.current?.key === savedEditKey) {
                setDraftError('');
                setDraftRead(current => current?.key === savedEditKey && current.error ? {key: savedEditKey} : current);
                if (draftEditVersion.current === sentEditVersion) {
                    savedReplyRef.current = null;
                    draftEditVersion.current++;
                    setContent('');
                    setIsTyping(false);
                    clearTimeout(typingTimer.current);
                    setDraftOrigin(null);
                    setEscalationDraftId(null);
                    setDraftFiles([]);
                }
            }
        } catch (error) {
            if (activeDraftViewRef.current?.key === savedEditKey) {
                if (error.data?.reason === 'conversation_changed') {
                    setDraftError('');
                    refreshConversation();
                } else setDraftError(error.message);
            }
            throw error;
        } finally {
            pendingReplySends.delete(savedEditKey);
            settleSend();
            if (activeDraftViewRef.current?.key === savedEditKey) setIsSending(false);
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
        savedReplyRef.current = null;
        setDraftReadAttempt(null);
        setDraftError('');
        setDraftRead(null);
        setContent('');
        setKnowledgeReferences([]);
        setDraftOrigin(null);
        setEscalationDraftId(null);
        setDraftFocusRequest(null);
        setLoadingContent('');
        setDraftFiles([]);
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
        // Erasure removes saved drafts and closes their ticket door. The retained
        // transcript is still readable, so do not request that unavailable draft.
        if (isContactErased) {
            savedReplyRef.current = null;
            writeSavedReplyEdit(savedEditKey, null);
            setDraftError(''); setContent(''); setDraftFiles([]); setNoteMacro(null);
            return;
        }
        let active = true;
        const editVersion = draftEditVersion.current;
        const read = () => nativeRequest(`/api/dashboard/projects/${conversationProjectId}/conversations/${conversationId}/macro-draft`);
        // A pending write can change the stored draft. On return, read it
        // once the write has settled and only while this view still needs it.
        const pending = pendingReplySends.get(savedEditKey) ?? pendingReplyUploads.get(savedEditKey);
        const result = pending ? pending.then(() => active ? read() : undefined) : read();
        result.then(result => {
                if (!active) return;
                setDraftRead({key: savedEditKey});
                if (draftEditVersion.current !== editVersion) return;
                const draft = result.data;
                const local = readSavedReplyEdit(savedEditKey);
                // A newer server draft belongs to a different use. If our own
                // clear already reached the server, restore only what we typed
                // afterward, without reviving the discarded template or media.
                const matches = local && (draft ? draft.usage_id === local.id : local.id === null || local.discarded);
                if (local && !matches) writeSavedReplyEdit(savedEditKey, null);
                if (draft?.reply_type === 'note') setNoteMacro({content:draft.content,media:draft.media || []});
                else if (matches) {
                    savedReplyRef.current = local.id === null ? null : {id: local.id, discarded: local.discarded};
                    const sameDraft = draft?.usage_id === local.id && !local.discarded;
                    restoreLocalReply(local, sameDraft ? draft : null);
                    if (sameDraft) setKnowledgeReferences(draft.references || []);
                } else if (draft) {
                    savedReplyRef.current = {id: draft.usage_id, discarded: false};
                    setContent(draft.content); setKnowledgeReferences(draft.references || []); setDraftFiles(draft.media || []);
                }
            }).catch(error => {
                if (!active) return;
                const definitive = error.status >= 400 && error.status < 500;
                const locked = !definitive && draftReadAttempt?.key !== savedEditKey;
                if (!locked && draftEditVersion.current === editVersion) restorePlainReply();
                setDraftRead({key: savedEditKey, locked, error: `Couldn’t load your saved macro draft: ${error.message}`});
            });
        return () => { active = false; };
    }, [conversationProjectId,conversationId,isConversationReady,isContactErased,savedEditKey,draftReadAttempt]);

    const updateDraftContent = (nextContent, attachments, origin, escalation = escalationDraftId) => {
        draftEditVersion.current++;
        setIsTyping(Boolean(nextContent)); clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setIsTyping(false), 1500);
        cancelDraftAdoption();
        draftConversationIdRef.current = conversationId;
        setContent(nextContent);
        const nextOrigin = origin ?? (nextContent.trim() ? draftOrigin : null);
        const nextFiles = Array.isArray(attachments)
            ? mergeDraftFiles(filesRef.current, attachments)
            : filesRef.current;
        setDraftOrigin(nextOrigin);
        setDraftFiles(nextFiles);
        setEscalationDraftId(escalation);
        const savedReply = savedReplyRef.current;
        const discard = savedReply && !savedReply.discarded && !nextContent.trim();
        if (discard) savedReply.discarded = true;
        persistReply(nextContent, nextFiles, nextOrigin, escalation);
        if (discard) {
            nativeRequest(`/api/dashboard/projects/${conversationProjectId}/conversations/${conversationId}/macro-draft?usage_id=${encodeURIComponent(savedReply.id)}`, { method: 'DELETE', keepalive: true })
                .catch(error => setDraftError(`Couldn’t discard your saved macro draft: ${error.message}`));
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
        if (!isComposerEnabled || router.latestLocation.pathname !== renderedPath) return false;
        updateDraftContent(draft.content, [], {kind:'human'}, draft.id);
        assistant.releaseDraft();
        setDraftFocusRequest(previous => ({conversationId, version: (previous?.version || 0) + 1}));
        return true;
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
                    {[401,403,404].includes(loadError.status)?'This ticket is unavailable. Your access or its group may have changed.':'Couldn’t load this conversation.'} <button type="button" onClick={ retryConversationLoad }>Retry</button>
                </p> : isBusy ? <p className="conversation-busy-notice" role="status">The workspace is busy. Trying again in a few seconds…</p> : <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Loading...</span>
                </div> }
            </div>
        </div>;
    }

    const messages = buckets.flatMap(bucket => bucket.messages || []);
    const presence = canFollow && <ConversationCollaboration projectId={conversationProjectId} conversationId={conversationId} currentUserId={currentAgent?.id} connected={socketConnected} socketEvent={socketEvent} sendSocket={sendSocket} hasDraft={Boolean(draftContent.trim() || draftFiles.length)} isTyping={isTyping}/>;
    const noteDraft = noteMacro && !isNoteModalVisible && <p className="conversation-note-draft" role="status">
        <i className="fe fe-lock" aria-hidden="true" /> Saved internal note draft <button className="btn btn-link btn-sm" type="button" onClick={()=>setIsNoteModalVisible(true)}>Review note</button>
    </p>;

    return (
        <ConversationSuggestionsProvider
            key={ conversationId }
            conversationId={ conversationId }
            message={ draftContent }
            draftOrigin={ draftOrigin }
            disabled={ isAssistantDisabled || Boolean(draftLoadState) || !isConversationReady || isLoading || isSending }
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
                        { (isBusy || isTranscriptBusy) && <p className="conversation-busy-notice px-2 py-2" role="status">The workspace is busy. Trying again in a few seconds…</p> }
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
                            draftVersionRef={draftEditVersion}
                            references={knowledgeReferences}
                            onReferencesChange={incoming => setKnowledgeReferences(current => mergeReferences(current,incoming))}
                            focusRequest={ draftFocusRequest?.conversationId === conversationId ? draftFocusRequest.version : 0 }
                            conversationId={ conversation.id }
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
                            isSwitching={ isSwitchingConversation }
                            isSendingReply={ isSendingReply }
                            draftLoadState={ draftLoadState }
                            onRetryDraftRead={ retryDraftRead }
                            onContinueWithoutDraft={ continueWithoutDraft }
                            presence={ presence }
                            noteDraft={ noteDraft }
                            draftError={ draftError || draftReadError }
                            ticketMenu={ ticketMenu }
                        /> : <NotesOnlyComposer onAddNote={ () => setIsNoteModalVisible(true) } presence={ presence } noteDraft={ noteDraft } draftError={ draftError || draftReadError } ticketMenu={ ticketMenu } /> }
                </div>

                { assistant.isCompactOpen && <button type="button" className="conversation-assistant-backdrop" onClick={ assistant.close } aria-label="Close conversation panel overlay" tabIndex={ -1 } /> }
                <ConversationAssistant
                    closeButtonRef={ assistant.closeRef }
                    draftError={ draftError }
                    isDraftDisabled={ !isComposerEnabled }
                    conversation={ conversation }
                    conversationId={ conversationId }
                    isCompactOpen={ assistant.isCompactOpen }
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
