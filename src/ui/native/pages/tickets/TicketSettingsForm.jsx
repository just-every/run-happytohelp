import React from 'react';
import { Field } from '../forms';
import { categories, label } from '../../../dashboard/components/tickets/ticket-model';

const types = ['text', 'number', 'decimal', 'date', 'dropdown', 'multiselect', 'checkbox', 'regex', 'account_lookup'];
export default function TicketSettingsForm({ kind, draft, setDraft, busy, onSubmit, onCancel, roles, agents }) {
    const change = (key, value) => setDraft(current => ({ ...current, [key]: value }));
    const rolePicker = (key, title) => <fieldset className="form-group"><legend className="form-label">{title}</legend>{roles.map(role => <label key={role.value} className="form-check"><input type="checkbox" className="form-check-input" checked={draft[key]?.includes(role.value) || false} onChange={event => change(key, event.target.checked ? [...(draft[key] || []), role.value] : draft[key].filter(value => value !== role.value))}/><span className="form-check-label">{role.label}</span></label>)}</fieldset>;
    return <form className="ticket-settings-form" onSubmit={onSubmit}>
        <Field name="ticket-definition-name" label="Name" required value={draft.name} onChange={(_, value) => change('name', value)}/>
        {kind === 'statuses' && <Field name="ticket-status-category" label="Lifecycle category" value={draft.category} onChange={(_, value) => change('category', value)} options={categories.map(value => ({ value, label: label(value) }))}/>}
        {kind === 'fields' && <>
            <Field name="ticket-field-type" label="Type" value={draft.type} options={types.map(value => ({ value, label: label(value) }))} onChange={(_, value) => change('type', value)}/>
            <Field name="ticket-field-required" label="Required" type="checkbox" value={draft.required} onChange={(_, value) => change('required', value)}/>
            {['dropdown', 'multiselect'].includes(draft.type) && <Field name="ticket-field-options" label="Options, one per line" type="textarea" required rows={4} value={(draft.options || []).join('\n')} onChange={(_, value) => change('options', value.split('\n'))}/>}
            {draft.type === 'regex' && <Field name="ticket-field-pattern" label="Validation pattern" required value={draft.validation?.pattern} onChange={(_, value) => change('validation', { ...draft.validation, pattern: value })}/>}
            {['number', 'decimal'].includes(draft.type) && <>{['min', 'max'].map(key => <Field key={key} name={`ticket-field-${key}`} label={label(key)} type="number" step="any" value={draft.validation?.[key]} onChange={(_, value) => { const validation = { ...draft.validation }; if (value === '') delete validation[key]; else validation[key] = value; change('validation', validation); }}/>)}</>}
            <p className="settings-note">Leave a role list empty to allow every role. Teammates still need ticket management permission to edit.</p>
            {rolePicker('read_roles', 'Roles that can read this field')}
            {rolePicker('write_roles', 'Roles that can edit this field')}
        </>}
        {kind === 'groups' && <fieldset><legend className="form-label">Members</legend>{agents.length ? agents.map(agent => <label key={agent.id} className="form-check"><input type="checkbox" className="form-check-input" checked={draft.members?.includes(agent.id) || false} onChange={event => change('members', event.target.checked ? [...(draft.members || []), agent.id] : draft.members.filter(id => id !== agent.id))}/><span className="form-check-label">{agent.name}</span></label>) : <p className="settings-note">No eligible agents.</p>}</fieldset>}
        <div className="settings-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : draft.id ? 'Save changes' : 'Create'}</button><button type="button" className="btn btn-link" disabled={busy} onClick={onCancel}>Cancel</button></div>
    </form>;
}
