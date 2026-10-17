import React from 'react';
import { Field, Section } from '../forms';
import RequestFormFields from './RequestFormFields';
import RequestFormTranslations from './RequestFormTranslations';

export default function RequestFormEditor({ draft, definitions, busy, onChange, onSubmit, onCancel }) {
    const change = (key, value) => onChange({ ...draft, [key]: value });
    const changeFields = fields => {
        const ids = new Set(['subject', 'message', ...fields.map(field => field.fieldId)]);
        const translations = Object.fromEntries(Object.entries(draft.translations).map(([locale, copy]) => [locale, { ...copy, ...(copy.fields ? { fields: Object.fromEntries(Object.entries(copy.fields).filter(([id]) => ids.has(id))) } : {}) }]));
        onChange({ ...draft, fields, translations });
    };
    return <form onSubmit={onSubmit} className="request-form-editor">
        <fieldset disabled={busy}>
            <Section card title={draft.id ? 'Edit request form' : 'New request form'} description="Choose what customers send to your team. Changes take effect when you save.">
                <Field name="request-form-title" label="Form name" required value={draft.title} onChange={(_, value) => change('title', value)}/>
                <Field name="request-form-description" label="Description" type="textarea" rows={3} value={draft.description} onChange={(_, value) => change('description', value)}/>
                <div className="request-form-basics"><Field name="request-form-locale" label="Default language code" required value={draft.locale} hint="For example en or en-US." onChange={(_, value) => change('locale', value)}/><Field name="request-form-submit" label="Submit button label" required value={draft.submitLabel} onChange={(_, value) => change('submitLabel', value)}/></div>
                <Field name="request-form-enabled" label="Publish this form" type="checkbox" value={draft.enabled} hint="Published forms are available to customers in your Help Center and widget." onChange={(_, value) => change('enabled', value)}/>
            </Section>
            <Section card title="Fields & conditions"><RequestFormFields selected={draft.fields} definitions={definitions} onChange={changeFields}/></Section>
            <Section card title="Languages"><RequestFormTranslations draft={draft} definitions={definitions} onChange={translations => change('translations', translations)}/></Section>
            <div className="settings-actions"><button type="submit" className="btn btn-primary">{busy ? 'Saving…' : draft.id ? 'Save changes' : 'Create form'}</button><button type="button" className="btn btn-link" onClick={onCancel}>Cancel</button></div>
        </fieldset>
    </form>;
}
