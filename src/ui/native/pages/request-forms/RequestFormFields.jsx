import React, { useState } from 'react';
import { Field } from '../forms';
import ConditionEditor from './ConditionEditor';
import { fieldName, movedFields, validOrder } from './form-model';
import { tooltip } from '../../../../modules/tooltip/tooltip';

export default function RequestFormFields({ selected, definitions, onChange }) {
    const [adding, setAdding] = useState('');
    const remaining = definitions.filter(field => !selected.some(item => item.fieldId === field.id));
    const change = (index, value) => onChange(selected.map((field, at) => at === index ? value : field));
    return <section className="request-form-fields" aria-labelledby="request-form-fields-title">
        <h3 id="request-form-fields-title">Request fields</h3>
        <p className="settings-note">Subject and Message are always included and required. Add ticket fields in the order customers should complete them. Only fields available to every role can appear on a public form.</p>
        <ol className="request-form-field-list">{selected.map((field, index) => {
            const definition = definitions.find(item => item.id === field.fieldId);
            const dependants = selected.filter(item => item.condition?.fieldId === field.fieldId);
            const name = fieldName(definitions, field.fieldId);
            return <li key={field.fieldId} className="request-form-field">
                <div className="request-form-field__heading"><div><h4 id={`request-field-${field.fieldId}-name`}>{name}</h4><p className="settings-note">{definition?.type || 'This field is no longer eligible for public forms.'}</p></div><div className="request-form-field__actions">
                    {[-1, 1].map(offset => <button key={offset} type="button" className="btn btn-outline-secondary btn-sm" {...tooltip(offset < 0 ? 'Move up' : 'Move down', { describedBy: `request-field-${field.fieldId}-name` })} disabled={index + offset < 0 || index + offset >= selected.length || !validOrder(movedFields(selected, index, offset))} onClick={() => onChange(movedFields(selected, index, offset))}>{offset < 0 ? '↑' : '↓'}</button>)}
                    <button type="button" className="btn btn-link btn-sm" disabled={dependants.length > 0} aria-label={`Remove ${name}`} onClick={() => onChange(selected.filter((_, at) => at !== index))}>Remove</button>
                </div></div>
                {dependants.length > 0 && <p className="settings-note">Remove conditions that use this field before removing it. Reordering keeps condition fields before their dependants.</p>}
                <Field name={`request-field-${field.fieldId}-required`} label={`Require ${name}`} type="checkbox" value={field.required} onChange={(_, required) => change(index, { ...field, required })}/>
                {index > 0 && (field.condition || selected.slice(0, index).some(item => definitions.some(definition => definition.id === item.fieldId))) && <ConditionEditor id={`request-field-${field.fieldId}`} condition={field.condition} previous={selected.slice(0, index)} definitions={definitions} onChange={condition => { const next = { ...field }; if (condition) next.condition = condition; else delete next.condition; change(index, next); }}/>}
            </li>;
        })}</ol>
        {!selected.length && <p className="settings-note">No custom fields added yet.</p>}
        <div className="request-form-add-field"><Field name="request-add-field" label="Add ticket field" value={adding} options={[{ value: '', label: remaining.length ? 'Choose a field…' : 'No more eligible fields' }, ...remaining.map(field => ({ value: field.id, label: field.name }))]} onChange={(_, value) => setAdding(value)}/><button type="button" className="btn btn-outline-secondary" disabled={!adding || selected.length >= 50} onClick={() => { const field = definitions.find(item => item.id === adding); onChange([...selected, { fieldId: adding, required: field.required }]); setAdding(''); }}>Add field</button></div>
    </section>;
}
