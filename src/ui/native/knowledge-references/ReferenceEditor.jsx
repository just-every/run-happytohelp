import React from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import {KnowledgeReferenceCard} from './KnowledgeReferences';
import {editableReferenceParts, removeReference} from './reference-text';

/** References stay opaque in content; only server-provided previews appear in cards. */
export default function ReferenceEditor({content = '', references = [], onChange, textareaRef, ...props}) {
    const parts = editableReferenceParts(content);
    return <div className="knowledge-reference-editor">{parts.map((part,index) => part.token
        ? <KnowledgeReferenceCard key={`${part.token}-${index}`} reference={references.find(reference => reference.token === part.token) || {token:part.token}} disabled={props.readOnly || props.disabled} onRemove={token => onChange(removeReference(content,token))}/>
        : <TextareaAutosize {...props} id={props.id ? `${props.id}${index ? `-${index}` : ''}` : undefined} minRows={parts.length > 1 ? 1 : props.minRows} placeholder={index === 0 ? props.placeholder : undefined} key={index} ref={element => {if (element && (!textareaRef.current?.isConnected || document.activeElement === element)) textareaRef.current = element;}} data-content-offset={part.start} value={part.text} onFocus={event => {textareaRef.current = event.target;}} onChange={event => onChange(content.slice(0,part.start) + event.target.value + content.slice(part.start + part.text.length))}/> )}</div>;
}
