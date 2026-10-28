import React, { useContext, useState } from 'react';
import { Button, Form, Modal } from "react-bootstrap";
import { useForm } from "react-hook-form";
import Api from "../api";
import { ChatContext } from "../contexts/ChatContext";
import DialogHeader from './DialogHeader';

function AddParticipantModal({ onHide, conversation }) {
    const {
        updateConversation,
    } = useContext(ChatContext);
    const [ errors, setErrors ] = useState({});
    const [ isValidated, setIsValidated ] = useState(null);
    const [ isLoading, setIsLoading ] = useState(false);
    const { register, handleSubmit } = useForm();

    const fields = [
        {
            name: 'email',
            label: 'Email',
            type: 'email',
        },
    ];

    const handleAddParticipant = values => {
        setIsLoading(true);
        setIsValidated(null);
        setErrors({});
        Api.create(`/projects/${ conversation.project_id }/conversations/${ conversation.id }/participants`, values)
            .then(data => {
                setIsLoading(false);
                updateConversation(conversation.id, {
                    participants: [ ...(conversation.participants || []).filter(participant => participant.pivot.id !== data.data.pivot.id), data.data ]
                });
                onHide();
            })
            .catch(error => {
                setIsLoading(false);
                setIsValidated(false);
                setErrors(error.errors || { email: [error.message || 'The recipient could not be added.'] });
            });
    }
    const submit = handleSubmit(handleAddParticipant, invalid => setErrors(Object.fromEntries(Object.entries(invalid).map(([name, error]) => [name, [error.message]]))));

    return (
        <Modal show onHide={ onHide }>
            <DialogHeader closeButton>
                <Modal.Title>Add Participant</Modal.Title>
            </DialogHeader>
            <Form onSubmit={ submit } onChange={ () => { setIsValidated(null); setErrors({})} } noValidate validated={ isValidated }>
                <Modal.Body>
                    { fields.map((field, i) => (
                        <Form.Group className="form-group" controlId={ `form-participant-${ field.name }` } key={ i }>
                            <Form.Label>{ field.label }</Form.Label>
                            <Form.Control
                                disabled={ isLoading }
                                type={ field.type ? field.type : 'text' }
                                { ...register(field.name, { required: 'Enter an email address', pattern: { value: /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/, message: 'Enter one valid email address' } }) }
                                isInvalid={ field.name in errors } />
                            { errors[field.name] && errors[field.name].map((error, i) => <Form.Control.Feedback key={ i } type="invalid">{ error }</Form.Control.Feedback>) }
                        </Form.Group>
                    )) }
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" disabled={ isLoading } onClick={ onHide }>Close</Button>
                    <Button variant="primary" type="submit" disabled={ isLoading }>Add</Button>
                </Modal.Footer>
            </Form>
        </Modal>
    );
}

export default AddParticipantModal;
