import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import useFileInput from 'use-file-input';
import MacrosPicker from './MacrosPicker';
import ArticlePicker from './ArticlePicker';
import TextareaAutosize from 'react-textarea-autosize';
import usePluginMessageEvent from '../hooks/usePluginMessageEvent';
import FormMedia from './FormMedia';
import ConversationComposerTools from './ConversationComposerTools';
import ConversationDraftStatus from './ConversationDraftStatus';
import ReplyIcon from './reply-icons/ReplyIcon';
import { insertSavedReply } from '../utils/insertSavedReply';

import '../styles/components/ConversationForm.scss';

ConversationForm.propTypes = {
    content: PropTypes.string,
    conversationId: PropTypes.string,
    files: PropTypes.array,
    finalReason: PropTypes.string,
    focusRequest: PropTypes.number,
    isEnabled: PropTypes.bool,
    isResolved: PropTypes.bool,
    loadingContent: PropTypes.string,
    onAddNote: PropTypes.func,
    onAssistantDisabledChange: PropTypes.func,
    onContentChange: PropTypes.func,
    onFileRemove: PropTypes.func,
    onFileSelect: PropTypes.func,
    onSendMessage: PropTypes.func,
    onMacroApplied: PropTypes.func,
    projectId: PropTypes.string,
};

export default function ConversationForm({
    content,
    conversationId,
    files,
    finalReason,
    focusRequest,
    isEnabled,
    isResolved,
    loadingContent,
    onAddNote,
    onAssistantDisabledChange,
    onContentChange,
    onFileRemove,
    onFileSelect,
    onSendMessage,
    onMacroApplied,
    projectId,
}) {
    const [ helper, setHelper ] = useState(null);
    const [ sendError, setSendError ] = useState('');
    const composerRef = useRef(null);
    const textareaRef = useRef(null);
    const hasContent = Boolean(content?.trim() || files.length);
    const isLoading = Boolean(loadingContent);
    const isComposerLocked = isLoading || Boolean(finalReason);
    const unresolved = [...new Set([...(content || '').matchAll(/{{\s*([^{}]+?)\s*}}/g)].map(match=>match[1].split('|')[0].trim()))];
    const canSend = Boolean(isEnabled && !helper && !isComposerLocked && hasContent && !unresolved.length);
    const textareaContent = isLoading && loadingContent !== '-loading-' ? loadingContent : content;

    useEffect(() => {
        onAssistantDisabledChange(Boolean(helper));
        return () => onAssistantDisabledChange(false);
    }, [ helper, onAssistantDisabledChange ]);

    useEffect(() => {
        setHelper(null);
    }, [ conversationId ]);

    useEffect(() => {
        if (!focusRequest) return undefined;
        // Wait for the committed draft and the compact panel's focus-trap cleanup.
        // The keyed form cancels this frame when its conversation is replaced.
        const frame = window.requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea?.isConnected) return;
            textarea.focus({ preventScroll: true });
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [ conversationId, focusRequest ]);

    const sendMessage = sendAndClose => {
        if (!canSend) return;

        setSendError('');
        onSendMessage(content, sendAndClose).then(() => {
            onContentChange('');
        }, error => setSendError(error.data?.reason === 'ticket_closed_followup_required'
            ? 'Not sent: this ticket was closed and is final. A customer reply opens a new ticket.'
            : `Not sent: ${ error.message || 'the server refused the reply' }.`));
    };

    const handleKeyDown = event => {
        if (event.isComposing) return;

        const isEnter = event.key === 'Enter' || event.keyCode === 13;
        if (!isEnter) return;

        const ua = navigator.userAgent;
        const iOS = (/iPad|iPhone|iPod/.test(ua)) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        // Ctrl/Cmd + Enter sends. Enter and Shift+Enter insert a newline.
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && !iOS) {
            event.preventDefault();
            sendMessage(false);
        }
    };

    const handleFileSelect = useFileInput(onFileSelect, {
        accept: '.jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt',
        multiple: false,
    });

    usePluginMessageEvent(event => {
        onContentChange(event.data.payload);
    }, 'setMessageContent');

    const openNoteModal = () => {
        if (isEnabled && !isComposerLocked) onAddNote();
    };

    const toggleMacros = () => {
        if (isEnabled && !isComposerLocked) setHelper(current => current === 'macros' ? null : 'macros');
    };

    // The textarea stays mounted while the picker is open, so its selection is still the cursor the agent left.
    const insertReply = (reply, metadata) => {
        if (metadata) onMacroApplied?.(reply, metadata);
        if (metadata?.reply_type === 'note') { setHelper(null); return; }
        const textarea = textareaRef.current;
        const draft = content || '';
        const { text, caret } = insertSavedReply(draft, reply, textarea?.selectionStart ?? draft.length, textarea?.selectionEnd ?? draft.length);
        onContentChange(text);
        setHelper(null);
        window.requestAnimationFrame(() => {
            textareaRef.current?.focus({ preventScroll: true });
            textareaRef.current?.setSelectionRange(caret, caret);
        });
    };

    const handleComposerSurfaceClick = event => {
        const target = event.target;
        if (!(target instanceof Element) || !composerRef.current?.contains(target)) return;

        if (target.closest('a, button, input, textarea, select, option, label, [contenteditable="true"], [role="button"], [role="menu"], [role="menuitem"], .conversation-composer__files, .conversation-composer__tools-menu, .dropdown-menu, .nav-tabs')) return;

        const isBlankComposerSurface = target === composerRef.current || target.matches('.chat-entry, .chat-entry > .flex-grow-1, .chat-entry-form, .chat-buttons, .chat-buttons > .col-auto, .conversation-composer__actions');
        if (!isBlankComposerSurface) return;

        const selection = window.getSelection?.();
        if (selection?.type === 'Range' && selection.toString()) return;

        if (!helper && !isComposerLocked) textareaRef.current?.focus({ preventScroll: true });
    };

    return (
        <div ref={ composerRef } className="chat-footer container-xxl" onClick={ handleComposerSurfaceClick }>
            <div className="chat-entry border-top border-light d-flex flex-row align-items-stretch w-100">
                <div className="flex-grow-1 d-flex flex-column">
                    { sendError && <p className="conversation-composer__error" role="alert">{ sendError }</p> }
                    <div className={ `chat-entry-form pt-3 pb-1${ loadingContent.length > 0 ? (loadingContent === '-loading-' ? ' loading loading-start' : ' loading') : '' }` }>
                        { helper === 'macros' && <MacrosPicker projectId={ projectId } onPicked={ insertReply } /> }
                        { helper === 'articles' && <ArticlePicker projectId={ projectId } conversationId={ conversationId } onPicked={ insertReply } /> }
                        { loadingContent.length > 0 && <div className="form-control form-control-flush loading-content" aria-live="polite">
                            <div className="loading-content-bg"></div>
                            <span className="loading-content-text">{ loadingContent === '-loading-' ? '' : loadingContent }</span>
                        </div> }
                        {unresolved.length > 0 && <p className="conversation-placeholder-warning text-danger" role="alert">Resolve before sending: {unresolved.join(', ')}</p>}
                        <TextareaAutosize
                            ref={ textareaRef }
                            className="form-control form-control-flush"
                            placeholder={ finalReason || 'Type your reply…' }
                            aria-label="Reply to conversation"
                            onKeyDown={ handleKeyDown }
                            onChange={ event => onContentChange(event.target.value) }
                            value={ textareaContent }
                            minRows={ 1 }
                            maxRows={ 10 }
                            readOnly={ isComposerLocked }
                            disabled={ Boolean(finalReason) }
                        />
                    </div>

                    <form className="row chat-buttons" onSubmit={ event => {
                        event.preventDefault();
                        sendMessage(false);
                    } }>
                        { files.length > 0 && <div className="ps-0 d-flex conversation-composer__files">
                            { files.map(file => <FormMedia key={ file.id } media={ file } onRemove={ onFileRemove } />) }
                        </div> }
                        <div className="col-auto flex-grow-1 d-flex gap-2 justify-content-end">
                            { !isEnabled && !helper && <span className="btn btn-ico rounded-circle text-gray-600 active" role="status" aria-live="polite">
                                <span className="visually-hidden">Uploading attachment</span>
                                <span className="spinner-border spinner-border-sm" aria-hidden="true"></span>
                            </span> }
                            <ConversationDraftStatus />
                            <div className="conversation-composer__actions">
                                <ConversationComposerTools
                                    disabled={ !isEnabled || isComposerLocked }
                                    hasHelper={ Boolean(helper) }
                                    canSend={ canSend }
                                    canClose={ !isResolved && !finalReason }
                                    onAttach={ handleFileSelect }
                                    onSaved={ toggleMacros }
                                    onArticle={ () => setHelper(current => current === 'articles' ? null : 'articles') }
                                    onNote={ openNoteModal }
                                    onSendAndClose={ () => sendMessage(true) }
                                />
                                <button type="submit" className={ `btn btn-primary${ hasContent && !canSend ? ' conversation-composer__send--blocked' : '' }` } disabled={ !canSend }>
                                    <ReplyIcon name="send" /> Send
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
