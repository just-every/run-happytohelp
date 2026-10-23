import React, {useEffect, useRef} from 'react';
import ReactDOM from "react-dom";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faTimes as falTimes} from "@fortawesome/free-solid-svg-icons";

const ModalPreview = ({ previewFile, hide, containerRef }) => {
    const dialogRef = useRef(null);
    const closeRef = useRef(null);

    useEffect(() => {
        if(!previewFile) return undefined;
        const rootNode = containerRef.current?.getRootNode();
        const previouslyFocused = rootNode?.activeElement || document.activeElement;
        const widgetRoot = rootNode?.querySelector('#happytohelp-root');
        const previousHidden = widgetRoot?.getAttribute('aria-hidden');
        const previouslyInert = widgetRoot?.inert;
        widgetRoot?.setAttribute('aria-hidden', 'true');
        if(widgetRoot) widgetRoot.inert = true;

        const focusables = () => Array.from(dialogRef.current?.querySelectorAll(
            'button:not([disabled]), iframe, a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []).filter(element => element.getAttribute('aria-hidden') !== 'true');

        closeRef.current?.focus();
        const handleKeyDown = event => {
            if(event.key === 'Escape') {
                event.preventDefault();
                hide();
                return;
            }
            if(event.key !== 'Tab') return;
            const items = focusables();
            if(!items.length) {
                event.preventDefault();
                closeRef.current?.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const activeElement = rootNode?.activeElement || document.activeElement;
            if(event.shiftKey && (activeElement === first || !dialogRef.current?.contains(activeElement))) {
                event.preventDefault();
                last.focus();
            } else if(!event.shiftKey && (activeElement === last || !dialogRef.current?.contains(activeElement))) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown, true);
        return () => {
            document.removeEventListener('keydown', handleKeyDown, true);
            if(previousHidden === null) widgetRoot?.removeAttribute('aria-hidden');
            else if(previousHidden !== undefined) widgetRoot?.setAttribute('aria-hidden', previousHidden);
            if(widgetRoot && previouslyInert !== undefined) widgetRoot.inert = previouslyInert;
            if(previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
        };
    }, [previewFile, hide, containerRef]);

    if(!previewFile) return null;
    const fileName = (previewFile.filename || previewFile.name || previewFile.path || 'attachment').replace(/^(?:\.\/)+/, '');
    const portalTarget = containerRef.current?.getRootNode();
    if(!portalTarget) return null;
    return ReactDOM.createPortal(
        <div id="happytohelp-modal-preview" role="dialog" aria-modal="true" aria-label={`Preview ${fileName}`} tabIndex={-1} ref={dialogRef} onClick={event => {
            if(event.target === event.currentTarget) hide();
        }}>
            <button type="button" className="happytohelp-modal-preview-close" aria-label="Close preview" data-h2h-tip="Close preview" ref={closeRef} onClick={hide}>
                <FontAwesomeIcon icon={falTimes} aria-hidden="true" />
            </button>
            {previewFile.isImage ?
                <img src={previewFile.url} alt={fileName} /> :
                <iframe src={previewFile.url} title={fileName} />
            }
        </div>, portalTarget
    );
};

export default ModalPreview;
