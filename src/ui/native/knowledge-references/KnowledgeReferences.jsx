import React from 'react';
import './knowledge-references.css';

export function KnowledgeReferenceCard({reference, onRemove, disabled, showPreview = true}) {
    const preview = typeof reference.preview === 'string' ? reference.preview : reference.preview?.content;
    return <article className="knowledge-reference-card" aria-label="Knowledge reference">
        <div className="knowledge-reference-card__heading"><strong>{reference.title || 'Knowledge reference'}</strong><span className="knowledge-reference-card__mode">{reference.mode === 'link' ? 'Link' : reference.mode === 'text' ? 'Text' : 'Reference'}</span>{onRemove && <button type="button" className="btn btn-white" disabled={disabled} onClick={() => onRemove(reference.token)} aria-label={`Remove ${reference.title || 'knowledge reference'}`}>Remove</button>}</div>
        {showPreview && preview && <p className="knowledge-reference-card__preview">{preview}</p>}
        {reference.recipients?.length > 0 && <ul className="knowledge-reference-card__recipients">{reference.recipients.map((recipient,index) => <li key={recipient.id || index} className={recipient.visible ? 'is-visible' : 'is-withheld'}><span>{recipient.visible ? 'Visible to' : 'Withheld from'} {recipient.label}</span>{!recipient.visible && recipient.reason && <small>{recipient.reason}</small>}</li>)}</ul>}
    </article>;
}

export default function KnowledgeReferences({references = [], onRemove, disabled, showPreview = true}) {
    if (!references.length) return null;
    return <div className="knowledge-reference-list">{references.map(reference => <KnowledgeReferenceCard key={reference.token} {...{reference,onRemove,disabled,showPreview}}/>)}</div>;
}
