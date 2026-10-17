import { ConversationSuggestionsProvider } from '../contexts/ConversationSuggestionsContext';
import React, { useContext, useEffect, useRef, useState } from 'react';
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
import { NotesOnlyComposer, useCan } from './ConversationAccess';
import ConversationCollaboration from './collaboration/ConversationCollaboration';
import ConversationActions from './conversation-actions/ConversationActions';
import MergedConversationHistory from './conversation-actions/MergedConversationHistory';
import {nativeRequest} from '../../native/transport';

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
    const [ isSending, setIsSending ] = useState(false);
    const [ atTop, setAtTop ] = useState(true);
    const [ files, setFiles ] = useState([]);
    const [ content, setContent ] = useState('');
    const [ draftOrigin, setDraftOrigin ] = useState(null);
    const [ draftFocusRequest, setDraftFocusRequest ] = useState(null);
    const [ draftError, setDraftError ] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const typingTimer = useRef(null);
    useEffect(() => () => clearTimeout(typingTimer.current), []);
    const [ loadingContent, setLoadingContent ] = useState('');
    const [ isAssistantDisabled, setIsAssistantDisabled ] = useState(false);
    const [ isNoteModalVisible, setIsNoteModalVisible ] = useState(false);
    const [noteMacro, setNoteMacro] = useState(null);
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
        cancelDraftAdoption();
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
                console.log(error);
                if (activeConversationIdRef.current === uploadConversationId) {
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
            ...(email ? {email} : {}),
        };
        if (sendAndClose) {
            message.resolve = true;
        }

        try {
            await sendAction('sendMessage', message, conversationProjectId);
            setDraftError('');
            setDraftOrigin(null);
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
        setDraftOrigin(null);
        setDraftFocusRequest(null);
        setLoadingContent('');
        setFiles([]);
        setIsSending(false);
        setIsAssistantDisabled(false);
        setIsNoteModalVisible(false);
        setNoteMacro(null);
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
                else { macroDraftUsageRef.current = draft.usage_id; setContent(draft.content); setFiles(draft.media || []); }
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
            <div className="chat">
                <div className="chat-body">
                    <ConversationHeader
                        conversation={ conversation }
                        onPanelToggle={ assistant.toggle }
                        isPanelVisible={ assistant.isVisible }
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
                        <MergedConversationHistory conversation={conversation} refreshKey={conversation.ticket_version}/>
                        <ConversationActions conversation={conversation} refreshKey={lastConnected} messages={buckets.flatMap(bucket=>bucket.messages || [])} onChanged={refreshConversation}/>
                        { loadMoreError && <p className="conversation-load-error px-2 py-2" role="alert">
                            Couldn’t load older messages. <button type="button" onClick={ loadOlderBuckets }>Retry</button>
                        </p> }
                    </ScrollToBottom>

                    {noteMacro && !isNoteModalVisible && <p className="px-3 py-2" role="status">You have a saved internal note draft. <button className="btn btn-link btn-sm" type="button" onClick={()=>setIsNoteModalVisible(true)}>Review note</button></p>}
                    {conversation.merged_into && <p className="px-3 py-2" role="status">This ticket was merged. <a href={`/conversations/${conversation.merged_into}`}>Open the surviving ticket</a>.</p>}
                    {canFollow && <ConversationCollaboration projectId={conversationProjectId} conversationId={conversationId} currentUserId={currentAgent?.id} socketEvent={socketEvent} sendSocket={sendSocket} hasDraft={Boolean(draftContent.trim() || draftFiles.length)} isTyping={isTyping}/> }
                    { draftError && <p className="conversation-load-error px-2 py-2" role="alert">{ draftError }</p> }
                    { !conversation.merged_into && (canReply ? <ConversationForm
                        key={ conversationId }
                        content={ draftContent }
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
                    /> : <>

                        <NotesOnlyComposer onAddNote={ () => setIsNoteModalVisible(true) } />
                    </>) }
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
                    panelRef={ assistant.panelRef }
                    requestedTab={ assistant.requestedTab }
                    requestedTabVersion={ assistant.requestedTabVersion }
                />

                { isNoteModalVisible && <NoteModal conversation={ conversation } initialContent={noteMacro?.content || ''} initialMedia={noteMacro?.media || []} onHide={ () => {setIsNoteModalVisible(false);setNoteMacro(null);} } /> }
            </div>
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
