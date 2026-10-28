import { useUnsavedChanges } from '../../native/NavigationGuard';
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, Modal } from "react-bootstrap";
import { useForm } from "react-hook-form";
import Api from "../api";
import { ChatContext } from "../contexts/ChatContext";
import { trapDialogTab } from './dialogTabBoundary';
import { nativeRequest } from '../../native/transport';
import FormMedia from './FormMedia';
import {addEditableMention,editableMentionDraft,submitMentionDraft} from './collaboration/mention-editor';
import { collaborationPath, mentionIds } from './collaboration/mentions';
import { tooltip } from '../../../modules/tooltip/tooltip';

function NoteModal({ onHide, conversation, initialContent = '', initialMedia = [] }) {
    const modalRef = useRef(null);
    const { markDirty, markSaved } = useUnsavedChanges();
    const cancel = () => { if (isLoading) return; markSaved(); onHide(); };
    const { fetchBucket } = useContext(ChatContext);
    const [ requestError, setRequestError ] = useState('');
    const [ errors, setErrors ] = useState({});
    const [ isValidated, setIsValidated ] = useState(null);
    const [ isLoading, setIsLoading ] = useState(false);
    const initialDraft=useMemo(()=>editableMentionDraft(initialContent),[]);
    const [selectedMentions,setSelectedMentions]=useState(initialDraft.mentions);
    const { register, handleSubmit, getValues, setValue } = useForm({ defaultValues: {content: initialDraft.text} });
    const [media, setMedia] = useState(initialMedia);
    useEffect(() => { if (initialContent || initialMedia.length) markDirty(); }, []);
    const [members, setMembers] = useState([]);
    const [mentionError, setMentionError] = useState('');
    useEffect(() => {
        let active = true;
        nativeRequest(`${collaborationPath(conversation.project_id, conversation.id)}/collaboration`)
            .then(result => { if (active) setMembers(result.data.members); })
            .catch(error => { if (active) setMentionError(error.message); });
        return () => { active = false; };
    }, [conversation.project_id, conversation.id]);
    const addMention = event => {
        const member = members.find(member => member.id === event.target.value);
        if (!member) return;
        const content = getValues('content') || '';
        const selected=addEditableMention(selectedMentions,member);setSelectedMentions(selected.mentions);
        setValue('content', `${content}${content && !/\s$/.test(content) ? ' ' : ''}${selected.mention.label} `, {shouldDirty: true});
        markDirty(); event.target.value = '';
    };

    const handleAddNote = values => {
        // Move focus before disabling the active control. Bootstrap's deferred
        // enforceFocus otherwise leaves native Tab outside the dialog until it runs.
        modalRef.current.dialog.focus();
        setRequestError('');
        setIsLoading(true);
        setIsValidated(null);
        setErrors({});
        const content=submitMentionDraft(values.content,selectedMentions);
        Api.create(`/projects/${ conversation.project_id }/conversations/${ conversation.id }/notes/`, {...values, content, mention_ids: mentionIds(content), media_ids: media.map(item => item.id)})
            .then(async data => {
                markSaved();
                await fetchBucket(conversation.id, {id: data.data.bucket_id}, undefined, conversation.project_id);
                setIsLoading(false);
                onHide();
            })
            .catch(error => {
                setIsLoading(false);
                setIsValidated(false);
                setErrors(error.errors || {});
                setRequestError(error.message);
            });
    }

    return (
        <Modal ref={ modalRef } show onHide={ cancel } aria-labelledby="add-note-title"
            onEnter={ dialog => dialog.addEventListener('keydown', trapDialogTab) }
            onExited={ dialog => dialog.removeEventListener('keydown', trapDialogTab) }>
            <Modal.Header>
                <Modal.Title id="add-note-title">Add Note</Modal.Title>
                <button type="button" className="btn-close" { ...tooltip('Close') } disabled={ isLoading } onClick={ cancel } />
            </Modal.Header>
            <Form aria-busy={ isLoading } onSubmit={ handleSubmit(handleAddNote) } onChange={ () => { markDirty(); setIsValidated(null); setErrors({})} } noValidate validated={ isValidated }>
                <Modal.Body>
                    {requestError && <p role="alert" className="alert alert-danger">{requestError}</p>}
                    <Form.Group className="form-group" controlId="form-note-content">
                        <Form.Label>Note</Form.Label>
                        <Form.Control
                            disabled={ isLoading }
                            as="textarea"
                            rows={3}
                            { ...register('content') }
                            isInvalid={ errors && !!errors['content'] } />
                        { errors && errors['content'] && errors['content'].map((error, i) => <Form.Control.Feedback key={ i } type="invalid">{ error }</Form.Control.Feedback>) }
                    </Form.Group>
                    {media.length > 0 && <div className="d-flex flex-wrap" aria-label="Note attachments" inert={isLoading || undefined}>
                        {media.map(item => <FormMedia key={item.id} media={item} onRemove={removed => { if (!isLoading) { setMedia(current => current.filter(item => item.id !== removed.id)); markDirty(); } }} />)}
                    </div>}
                    <Form.Group className="form-group" controlId="form-note-mention">
                        <Form.Label>Mention a teammate</Form.Label>
                        <Form.Select defaultValue="" disabled={isLoading || !members.length} onChange={addMention}>
                            <option value="">Choose a teammate…</option>
                            {members.map(member => <option key={member.id} value={member.id}>@{member.name}</option>)}
                        </Form.Select>
                        <Form.Text>Only teammates in this workspace can be mentioned. Notes stay private.</Form.Text>
                        {mentionError && <p role="alert" className="text-danger">{mentionError}</p>}
                    </Form.Group>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" disabled={ isLoading } onClick={ cancel }>Close</Button>
                    <Button variant="primary" type="submit" disabled={ isLoading }>Add</Button>
                </Modal.Footer>
            </Form>
        </Modal>
    );
}

export default NoteModal;
