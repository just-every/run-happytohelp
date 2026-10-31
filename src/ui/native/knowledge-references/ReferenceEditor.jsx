import React,{useRef} from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import {KnowledgeReferenceCard} from './KnowledgeReferences';
import {editableReferenceParts, removeReference} from './reference-text';

/** References stay opaque in content; only server-provided previews appear in cards. */
export default function ReferenceEditor({content = '', references = [], onChange, textareaRef, ...props}) {
    const latest = useRef(content);
    latest.current = content;
    const parts = editableReferenceParts(content);
    const changePart = (index,value) => {
        const part = editableReferenceParts(latest.current)[index];
        if (!part || part.token) return;
        const next = latest.current.slice(0,part.start) + value + latest.current.slice(part.start + part.text.length);
        latest.current = next;
        onChange(next);
    };
    return <div className="knowledge-reference-editor">{parts.map((part,index) => part.token
        ? <KnowledgeReferenceCard key={`${part.token}-${index}`} reference={references.find(reference => reference.token === part.token) || {token:part.token}} disabled={props.readOnly || props.disabled} onRemove={token => {latest.current = removeReference(latest.current,token);onChange(latest.current);}}/>
        : <TextareaAutosize {...props} id={props.id ? `${props.id}${index ? `-${index}` : ''}` : undefined} minRows={parts.length > 1 ? 1 : props.minRows} placeholder={index === 0 ? props.placeholder : undefined} key={index} ref={element => {if (element && (!textareaRef.current?.isConnected || document.activeElement === element)) textareaRef.current = element;}} data-content-offset={part.start} value={part.text} onFocus={event => {textareaRef.current = event.target;}} onChange={event => changePart(index,event.target.value)}/> )}</div>;
}
