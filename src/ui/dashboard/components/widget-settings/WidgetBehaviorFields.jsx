import React from 'react';
import { Form } from 'react-bootstrap';
import WidgetFieldSection from './WidgetFieldSection';

const groups = [
    { title: 'Glow effects', fields: [
        ['settings[show_glow][on_insight]', 'On insight'],
        ['settings[show_glow][on_insight_reply]', 'On insight reply'],
        ['settings[show_glow][on_ai_typing]', 'While AI is typing'],
        ['settings[show_glow][on_human_typing]', 'While a teammate is typing'],
    ] },
    { title: 'Message capture', fields: [
        ['settings[message][collect_screenshot]', 'Collect screenshots'],
        ['settings[message][collect_attachments]', 'Collect attachments'],
    ] },
    { title: 'Required contact details', fields: [
        ['settings[collect][require_name]', 'Require name'],
        ['settings[collect][require_email]', 'Require email'],
    ] },
];

export const behaviorFieldNames = groups.flatMap(({ fields }) => fields.map(([name]) => name));

export default function WidgetBehaviorFields({ register, projectId }) {
    return groups.map(({ title, fields }) => (
        <WidgetFieldSection key={title} title={title}>
            {title === 'Glow effects' && <p className="settings-note" style={{gridColumn:'1 / -1'}}>On insight makes the chat button glow when Help before they ask offers a visitor help. Turn that on in <a href={`/projects/${projectId}/settings#help-before-they-ask`}>Project settings, Help before they ask</a>.</p>}
            {title === 'Required contact details' && <p className="settings-note" style={{gridColumn:'1 / -1'}}>Fresh installs ask visitors for an email before they send a message. Turn off Require email here to stop asking. Your saved choice is retained. On a hosted installation with email sending configured, operator replies can reach that address.</p>}
            {fields.map(([name, label]) => (
                <div key={name}>
                    <Form.Check type="switch" id={`widget-${name.replace(/[^a-z0-9]+/gi, '-')}`}
                        label={label} {...register(name)} />
                </div>
            ))}
        </WidgetFieldSection>
    ));
}
