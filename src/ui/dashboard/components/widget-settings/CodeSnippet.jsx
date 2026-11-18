import React, { useLayoutEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import hljs from 'highlight.js';
import useCopyFeedback from './useCopyFeedback';

export default function CodeSnippet({
    code,
    language,
    copyLabel = 'Copy code',
    copyAriaLabel = copyLabel,
    aiCode,
    aiCopyAriaLabel,
    disabled = false,
    unavailable,
}) {
    const codeElement = useRef(null);
    const { copy, feedback } = useCopyFeedback();

    useLayoutEffect(() => {
        const element = codeElement.current;
        if (!element) return;

        delete element.dataset.highlighted;
        hljs.highlightElement(element);
    }, [code, language, disabled]);

    return (
        <div className="widget-code__snippet">
            <div className="widget-code__snippet-actions">
                <div className="widget-code__snippet-buttons">
                    <button type="button" className="widget-code__copy" aria-label={copyAriaLabel} disabled={disabled} onClick={() => copy(code)}>
                        <i className="fe fe-copy" aria-hidden="true" /> {copyLabel}
                    </button>
                    <button type="button" className="widget-code__copy widget-code__copy--ai" aria-label={aiCopyAriaLabel} disabled={disabled} onClick={() => copy(aiCode)}>
                        <i className="fe fe-zap" aria-hidden="true" /> Copy for AI
                    </button>
                </div>
                <span className="widget-code__copy-feedback" role="status" aria-live="polite">{feedback}</span>
            </div>
            {disabled ? <p className="widget-code__unavailable" role="status">{unavailable}</p> : <pre tabIndex={0} aria-label={`${language} code`}><code ref={codeElement} className={`language-${language}`}>{code}</code></pre>}
        </div>
    );
}

CodeSnippet.propTypes = {
    code: PropTypes.string.isRequired,
    language: PropTypes.string.isRequired,
    copyLabel: PropTypes.string,
    copyAriaLabel: PropTypes.string,
    aiCode: PropTypes.string.isRequired,
    aiCopyAriaLabel: PropTypes.string.isRequired,
};
