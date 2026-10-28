import React from 'react';
import { Form } from 'react-bootstrap';
import WidgetFieldSection from './WidgetFieldSection';
import { defaultFor } from './settingsModel';

const groups = [
    { title: "AI labels", fields: [
        ["text[ai][chat]", "AI assisted conversation"],
        ["text[ai][selection]", "AI selection"],
        ["text[ai][ai]", "AI"],
        ["text[ai][ai_response]", "AI response time"],
        ["text[ai][human]", "Human"],
        ["text[ai][human_response]", "Human response time"],
    ] },
    { title: "Message composer", fields: [
        ["text[message][placeholder_message]", "Message placeholder"],
        ["text[message][placeholder_message_chat]", "Chat message placeholder"],
        ["text[message][placeholder_files]", "Files placeholder"],
        ["text[message][tooltip_contact]", "Edit details tooltip"],
        ["text[message][tooltip_screenshot]", "Screenshot tooltip"],
        ["text[message][tooltip_attach]", "Attach tooltip"],
        ["text[message][tooltip_send]", "Send tooltip"],
        ["text[message][button_send]", "Send button"],
        ["text[message][error_name]", "Name error"],
        ["text[message][error_email]", "Email error"],
        ["text[message][error_message]", "Message error"],
    ] },
    { title: "Contact details", fields: [
        ["text[collect][placeholder_name]", "Name placeholder"],
        ["text[collect][placeholder_email]", "Email placeholder"],
    ] },
    { title: "Prompts", fields: [
        ["text[prompt][email_prompt]", "Receive an email"],
        ["text[prompt][edit_contact]", "Edit your contact"],
        ["text[prompt][placeholder_email]", "Email placeholder"],
        ["text[prompt][validate_error]", "Validation error"],
    ] },
    { title: "When your team is away", fields: [
        ["text[away][title]", "Away heading"],
        ["text[away][back]", "Back time, {when} is the day and time"],
        ["text[away][email_ask]", "Ask for an email"],
        ["text[away][email_known]", "Email known, {email} is the address"],
        ["text[away][email_prompt]", "Email field note"],
        ["text[away][header]", "Header status"],
        ["text[away][header_back]", "Header status with back time"],
    ] },
    { title: "Conversation status", fields: [
        ["text[chat][return_title]", "Return title"],
        ["text[chat][return_last_message]", "Return last message"],
        ["text[chat][return_active]", "Return active"],
        ["text[chat][sending]", "Sending"],
        ["text[chat][sending_image]", "Sending Image"],
        ["text[chat][sending_images]", "Sending Images"],
        ["text[chat][sending_file]", "Sending File"],
        ["text[chat][sending_files]", "Sending Files"],
        ["text[chat][failed]", "Failed"],
        ["text[chat][sent]", "Sent"],
        ["text[chat][received]", "Received"],
    ] },
    { title: "Errors", fields: [
        ["text[errors][connection]", "Connection"],
    ] },
];

export const textFieldNames = groups.flatMap(({ fields }) => fields.map(([name]) => name));

export default function WidgetTextFields({ register }) {
    return groups.map(({ title, fields }) => (
        <WidgetFieldSection key={title} title={title}>
            {fields.map(([name, label]) => (
                <Form.Group key={name} controlId={`widget-${name.replace(/[^a-z0-9]+/gi, "-")}`} className="form-group">
                    <Form.Label>{label}</Form.Label>
                    <Form.Control type="text" placeholder={defaultFor(name)} {...register(name)} />
                </Form.Group>
            ))}
        </WidgetFieldSection>
    ));
}
