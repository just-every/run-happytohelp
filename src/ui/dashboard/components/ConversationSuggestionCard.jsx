import React, { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import ReactMarkdown from 'react-markdown';
import gfm from 'remark-gfm';
import ReplyIcon, { hasReplyIcon } from './reply-icons/ReplyIcon';
import { Sparks } from '../../homepage/drawings/Sparks';
import { tooltip } from '../../../modules/tooltip/tooltip';

// The selectable reply remains a button, so Markdown is rendered with phrasing
// elements only. This keeps the expansion button a valid sibling control.
const preserveLineBreaks = children => React.Children.toArray(children).flatMap((child, childIndex) => {
    if (typeof child !== 'string') {
        if (React.isValidElement(child) && (child.type === 'code' || child.type === 'pre')) return [child];
        return React.isValidElement(child) && child.props.children !== undefined
            ? [React.cloneElement(child, { children: preserveLineBreaks(child.props.children) })]
            : [child];
    }

    return child.split(/\r?\n/).flatMap((line, lineIndex) => (
        lineIndex === 0 ? [line] : [<br key={ `${ childIndex }-${ lineIndex }` } />, line]
    ));
});

const previewMarkdownComponents = {
    a: ({ children }) => <span className="conversation-suggestions__preview-link">{ children }</span>,
    blockquote: ({ children }) => <span className="conversation-suggestions__preview-quote">{ preserveLineBreaks(children) }</span>,
    h1: ({ children }) => <span className="conversation-suggestions__preview-heading">{ preserveLineBreaks(children) }</span>,
    h2: ({ children }) => <span className="conversation-suggestions__preview-heading">{ preserveLineBreaks(children) }</span>,
    h3: ({ children }) => <span className="conversation-suggestions__preview-heading">{ preserveLineBreaks(children) }</span>,
    h4: ({ children }) => <span className="conversation-suggestions__preview-heading">{ preserveLineBreaks(children) }</span>,
    h5: ({ children }) => <span className="conversation-suggestions__preview-heading">{ preserveLineBreaks(children) }</span>,
    h6: ({ children }) => <span className="conversation-suggestions__preview-heading">{ preserveLineBreaks(children) }</span>,
    img: ({ alt }) => alt ? <span className="conversation-suggestions__preview-image-alt">{ alt }</span> : null,
    li: ({ children }) => <span className="conversation-suggestions__preview-list-item">{ preserveLineBreaks(children) }</span>,
    ol: ({ children }) => <span className="conversation-suggestions__preview-list is-ordered">{ children }</span>,
    p: ({ children }) => <span className="conversation-suggestions__preview-paragraph">{ preserveLineBreaks(children) }</span>,
    ul: ({ children }) => <span className="conversation-suggestions__preview-list">{ children }</span>,
};

export default function ConversationSuggestionCard({ disabled, icon, label, onSelect, response, selected, useWhen }) {
    const previewRef = useRef(null);
    const previewId = `conversation-suggestion-preview-${ useId() }`;
    const [ isExpanded, setIsExpanded ] = useState(false);
    const [ isExpandable, setIsExpandable ] = useState(false);

    useLayoutEffect(() => {
        setIsExpanded(false);
    }, [ response ]);

    const measureOverflow = useCallback(() => {
        const preview = previewRef.current;
        if (!preview || isExpanded) return;

        setIsExpandable(preview.scrollHeight > preview.clientHeight + 1);
    }, [ isExpanded ]);

    useLayoutEffect(() => {
        const preview = previewRef.current;
        if (!preview) return undefined;

        measureOverflow();
        const observer = new ResizeObserver(measureOverflow);
        observer.observe(preview);

        return () => observer.disconnect();
    }, [ measureOverflow, response ]);

    return <article className={ `conversation-suggestion-card${ selected ? ' is-selected' : '' }${ isExpandable ? ' is-expandable' : '' }` }>
        <Sparks />
        <button
            type="button"
            className={ `conversation-suggestions__option${ selected ? ' is-selected' : '' }` }
            onClick={ onSelect }
            disabled={ disabled }
            aria-pressed={ selected }
        >
            { hasReplyIcon(icon) && <span className="conversation-suggestion-card__icon">
                <ReplyIcon name={ icon } />
            </span> }
            <span className="conversation-suggestion-card__content">
                <span className="conversation-suggestion-card__header">
                    <span className="conversation-suggestion-card__heading">{ label }</span>
                </span>
                { useWhen && <span className="conversation-suggestion-card__condition">
                    <strong>Use when:</strong> { useWhen }
                </span> }
                <span
                    id={ previewId }
                    ref={ previewRef }
                    className={ `conversation-suggestions__preview${ isExpanded ? ' is-expanded' : '' }` }
                >
                    <ReactMarkdown remarkPlugins={ [ gfm ] } components={ previewMarkdownComponents }>
                        { response }
                    </ReactMarkdown>
                </span>
            </span>
        </button>
        { isExpandable && <button
            type="button"
            className="conversation-suggestion-card__toggle"
            { ...tooltip(isExpanded ? 'Collapse reply' : 'Expand reply') }
            aria-expanded={ isExpanded }
            aria-controls={ previewId }
            onClick={ event => {
                event.stopPropagation();
                setIsExpanded(expanded => !expanded);
            } }
        >
            <ReplyIcon name={ isExpanded ? 'chevron-up' : 'chevron-down' } />
        </button> }
    </article>;
}

ConversationSuggestionCard.propTypes = {
    disabled: PropTypes.bool,
    icon: PropTypes.string,
    label: PropTypes.string.isRequired,
    onSelect: PropTypes.func.isRequired,
    response: PropTypes.string.isRequired,
    selected: PropTypes.bool,
    useWhen: PropTypes.string,
};
