import React, { useRef, useState } from 'react';
import '../article-editor.css';
import ReactMarkdown from 'react-markdown';
import gfm from 'remark-gfm';
import Api from '../api';
import ReplyIcon from './reply-icons/ReplyIcon';
import {
    bulletList,
    heading,
    imageMarkdown,
    orderedList,
    quote,
    replaceSelection,
    wrapSelection,
} from '../article-markdown-editor-utils';
import { tooltip } from '../../../modules/tooltip/tooltip';

function selectEditorFile() {
    return new Promise(resolve => {
        const picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = 'image/jpeg,image/png,image/gif';
        picker.addEventListener('change', () => resolve(picker.files[0] || null), { once: true });
        picker.click();
    });
}

function restoreSelection(textarea, selectionStart, selectionEnd) {
    window.requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(selectionStart, selectionEnd);
    });
}

export default function ArticleMarkdownEditor({ initialMarkdown, inputId, onMarkdownChange, required }) {
    const textareaRef = useRef(null);
    const [ markdown, setMarkdown ] = useState(initialMarkdown);
    const [ error, setError ] = useState(null);
    const [ view, setView ] = useState('write');

    const updateMarkdown = value => {
        setMarkdown(value);
        onMarkdownChange(value);
    };

    const showWriteView = () => {
        setView('write');
    };

    const applyEdit = edit => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const result = edit(textarea.value, textarea.selectionStart, textarea.selectionEnd);
        updateMarkdown(result.value);
        restoreSelection(textarea, result.selectionStart, result.selectionEnd);
    };

    const uploadImage = async () => {
        const file = await selectEditorFile();
        if (!file) return;

        const projectId = window.chatSettings && window.chatSettings.projectId;
        if (!projectId) {
            setError('The article editor cannot upload an image without a project id.');
            return;
        }

        try {
            const body = new FormData();
            body.append('file', file);
            const response = await Api.create(`/projects/${ projectId }/media`, body);
            const imageUrl = response && response.data && response.data.url;
            if (!imageUrl) throw new Error('The image upload response did not include a media URL.');

            const image = imageMarkdown(imageUrl, file.name);
            applyEdit((value, selectionStart, selectionEnd) => replaceSelection(
                value,
                selectionStart,
                selectionEnd,
                image,
                image.length,
                image.length,
            ));
            setError(null);
        } catch (uploadError) {
            console.error('Article image upload failed.', uploadError);
            setError(uploadError.message || 'The image could not be uploaded. Please try again.');
        }
    };

    const promptForLink = () => {
        const url = window.prompt('Enter link URL');
        if (!url) return;
        applyEdit((value, selectionStart, selectionEnd) => wrapSelection(value, selectionStart, selectionEnd, '[', `](${ url })`, 'link text'));
    };

    const toolbar = [
        { label: 'Heading', icon: 'heading-1', action: () => applyEdit((value, start, end) => heading(value, start, end)) },
        { label: 'Bold', icon: 'bold', action: () => applyEdit((value, start, end) => wrapSelection(value, start, end, '**', '**')) },
        { label: 'Italic', icon: 'italic', action: () => applyEdit((value, start, end) => wrapSelection(value, start, end, '*', '*')) },
        { label: 'Inline code', icon: 'code', action: () => applyEdit((value, start, end) => wrapSelection(value, start, end, '`', '`', 'code')) },
        { label: 'Bulleted list', icon: 'list', action: () => applyEdit((value, start, end) => bulletList(value, start, end)) },
        { label: 'Numbered list', icon: 'list-ordered', action: () => applyEdit((value, start, end) => orderedList(value, start, end)) },
        { label: 'Quote', icon: 'quote', action: () => applyEdit((value, start, end) => quote(value, start, end)) },
        { label: 'Link', icon: 'link', action: promptForLink },
        { label: 'Upload image', icon: 'image-plus', action: uploadImage },
    ];

    return <div className="article-markdown-editor">
        <div className="article-markdown-header">
            { view === 'write' && <div className="article-markdown-toolbar" role="toolbar" aria-label="Markdown formatting">
                { toolbar.map(tool => <button
                    key={ tool.label }
                    type="button"
                    className="article-markdown-tool"
                    { ...tooltip(tool.label) }
                    onMouseDown={ event => event.preventDefault() }
                    onClick={ tool.action }
                >
                    <ReplyIcon name={ tool.icon } className="article-markdown-tool__icon" />
                </button>) }
            </div> }
            <div className="article-markdown-tabs" role="tablist" aria-label="Article editor view">
                <button
                    type="button"
                    className={ `article-markdown-tab${ view === 'write' ? ' is-active' : '' }` }
                    role="tab"
                    aria-selected={ view === 'write' }
                    onClick={ showWriteView }
                >
                    Write
                </button>
                <button
                    type="button"
                    className={ `article-markdown-tab${ view === 'preview' ? ' is-active' : '' }` }
                    role="tab"
                    aria-selected={ view === 'preview' }
                    onClick={ () => setView('preview') }
                >
                    Preview
                </button>
            </div>
        </div>
        <textarea
            ref={ textareaRef }
            id={ inputId }
            className="article-markdown-editor__input"
            value={ markdown }
            onChange={ event => updateMarkdown(event.target.value) }
            aria-label="Article content in Markdown"
            placeholder="Write your article…"
            hidden={ view !== 'write' }
            onInvalid={ showWriteView }
            required={ required }
            spellCheck="true"
        />
        <div
            className="article-markdown-editor__preview"
            hidden={ view !== 'preview' }
            aria-label="Article preview"
        >
            <ReactMarkdown remarkPlugins={ [ gfm ] }>{ markdown }</ReactMarkdown>
        </div>
        { error && <p className="article-markdown-editor__error" role="alert">{ error }</p> }
    </div>;
}
