import React from 'react';
import { fieldOptions, typedValue } from './ticket-model';

/** The same typed control is used for an issue value and a view's predicate. */
export default function TicketField({ field, value, onChange, disabled = false, id, required = field.required, label = field.name }) {
    const options = fieldOptions(field); if (field.type === 'account' && value && !options.some(option => option.value === value)) options.push({value, label: 'Account unavailable', disabled: true});
    const multi = field.type === 'multiselect';
    const props = { id, disabled, required, className: options.length || ['dropdown', 'multiselect', 'account'].includes(field.type) ? 'form-select' : 'form-control' };
    let control;
    if (field.type === 'checkbox') control = <input id={id} type="checkbox" className="form-check-input" disabled={disabled} checked={Boolean(value)} onChange={event => onChange(event.target.checked)}/>;
    else if (['dropdown', 'multiselect', 'account'].includes(field.type)) control = <select {...props} multiple={multi} value={value ?? (multi ? [] : '')} onChange={event => onChange(multi ? [...event.target.selectedOptions].map(item => item.value) : event.target.value)}>{!multi && <option value="">Choose…</option>}{options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select>;
    else control = <input {...props} type={['number', 'decimal'].includes(field.type) ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime-local' ? 'datetime-local' : 'text'} step={field.type === 'decimal' ? 'any' : field.type === 'number' ? '1' : undefined} min={field.validation?.min} max={field.validation?.max} value={value ?? ''} onChange={event => onChange(typedValue(field, event.target.value))}/>;
    return <div className="form-group ticket-field"><label htmlFor={id} className="form-label">{label}{required ? ' *' : ''}</label>{control}{field.description && <div className="form-text">{field.description}</div>}</div>;
}
