import React, { useId, useState } from 'react';
import { tooltip } from '../../../../modules/tooltip/tooltip';

// The article's status bar: a drawn card with the status chip and the actions. On a phone Save and Publish ride in a bar
// fixed to the bottom of the screen, and Delete and Unpublish wait behind a More button there (knowledge.css).
// A published article offers Save (which keeps it published) and Unpublish, not Publish again.
export default function ArticleEditorActions({ isPublished, savedStatus, busy, unavailable = false, onPublish, onDelete, onUnpublish }) {
    const status = savedStatus || (isPublished ? 'Published' : 'Draft');
    const [moreOpen, setMoreOpen] = useState(false);
    const moreId = useId();
    const hasMore = Boolean(onDelete) || isPublished;

    return <div className="article-editor-actions h2h-card" role="group" aria-label="Article save and publish">
        <p className="article-editor-actions__status" role="status" aria-live="polite">
            <span>Status</span>
            <strong className="h2h-chip">{status === 'Published' && <i className="fe fe-check" aria-hidden="true"/>}{status}</strong>
        </p>
        <div className="article-editor-actions__buttons knowledge-form-actions">
            {hasMore && <div id={moreId} className={`article-editor-actions__more${moreOpen ? ' is-open' : ''}`}>
                {onDelete && <button className="btn btn-danger" type="button" disabled={busy || unavailable} onClick={onDelete}>Delete</button>}
                {isPublished && <button className="btn btn-white" type="button" disabled={busy || unavailable} onClick={onUnpublish}>Unpublish</button>}
            </div>}
            {hasMore && <button className="btn btn-white btn-icon article-editor-actions__more-toggle" type="button" {...tooltip('More actions')} aria-expanded={moreOpen} aria-controls={moreId} onClick={() => setMoreOpen(open => !open)}><i className="fe fe-more-horizontal" aria-hidden="true"/></button>}
            <button className={isPublished ? 'btn btn-primary' : 'btn btn-white'} type="submit" disabled={busy || unavailable}>
                {busy ? 'Saving…' : 'Save'}
            </button>
            {!isPublished && <button className="btn btn-primary" type="button" disabled={busy || unavailable} onClick={onPublish}>
                {busy ? 'Publishing…' : 'Publish'}
            </button>}
        </div>
    </div>;
}
