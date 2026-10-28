import React, { useContext, useState } from 'react';
import { Button, Form, Modal } from "react-bootstrap";
import { useForm } from "react-hook-form";
import Api from "../api";
import { ChatContext } from "../contexts/ChatContext";
import DialogHeader from './DialogHeader';

function ContactUpdateModal({ onHide, contact, conversation }) {
    const {
        updateConversation,
    } = useContext(ChatContext);
    const [ errors, setErrors ] = useState({});
    const [ isValidated, setIsValidated ] = useState(null);
    const [ isLoading, setIsLoading ] = useState(false);
    const { register, handleSubmit, getValues } = useForm({ defaultValues: contact });

    const fields = [
        {
            name: 'email',
            label: 'Email',
            type: 'email',
        },
        {
            name: 'provided_email',
            label: 'Provided Email',
            type: 'email',
        },
        {
            name: 'name',
            label: 'Name',
        },
        {
            name: 'provided_name',
            label: 'Provided Name',
        },
    ];

    const handleContactUpdate = values => {
        setIsLoading(true);
        setIsValidated(null);
        setErrors({});
        Api.update(`/projects/${ conversation.project_id }/contacts/${ contact.id }`, values)
            .then(data => {
                setIsLoading(false);
                updateConversation(conversation.id, { contact: data.data });
                onHide();
            })
            .catch(error => {
                setIsLoading(false);
                setIsValidated(false);
                setErrors(error.errors);
            });
    }

    return (
        <Modal show onHide={ onHide }>
            <DialogHeader closeButton>
                <Modal.Title>Edit Contact</Modal.Title>
            </DialogHeader>
            <Form onSubmit={ handleSubmit(handleContactUpdate) } onChange={ () => { setIsValidated(null); setErrors({})} } noValidate validated={ isValidated }>
                <Modal.Body>
                    { fields.map((field, i) => (
                        <Form.Group className="form-group" controlId={ `form-contact-${ field.name }` } key={ i }>
                            <Form.Label>{ field.label }</Form.Label>
                            <Form.Control
                                disabled={ isLoading }
                                type={ field.type ? field.type : 'text' }
                                { ...register(field.name) }
                                isInvalid={ field.name in errors } />
                            { errors[field.name] && errors[field.name].map((error, i) => <Form.Control.Feedback key={ i } type="invalid">{ error }</Form.Control.Feedback>) }
                        </Form.Group>
                    )) }
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" disabled={ isLoading } onClick={ onHide }>Close</Button>
                    <Button variant="primary" disabled={ isLoading } onClick={ handleSubmit(handleContactUpdate) }>Save</Button>
                </Modal.Footer>
            </Form>
        </Modal>
    );
}

export default ContactUpdateModal;
