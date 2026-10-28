import React from 'react';
import TicketField from './TicketField';
import TicketIdentityPicker from './TicketIdentityPicker';
import { fieldOptions } from './ticket-model';

export default function TicketFilterValue({ field, row, index, onChange, projectId, contacts }) {
    const id = `view-filter-${index}`, multi = ['in', 'not_in'].includes(row.operator);
    if (field.identity === 'contact' && !multi && ['eq', 'ne'].includes(row.operator)) return <TicketIdentityPicker key={`${field.value}-${index}`} id={id} label="Value" projectId={projectId} value={row.value} currentContact={contacts.find(contact => contact.id === row.value)} onChange={onChange}/>;
    const named = field.options !== undefined || field.type === 'checkbox';
    if (named && (['eq', 'ne', 'in', 'not_in'].includes(row.operator) || field.type === 'multiselect')) {
        const options = field.type === 'checkbox' ? [{ value: true, label: 'Yes' }, { value: false, label: 'No' }] : fieldOptions(field);
        const available = options.filter(option => !multi || option.value !== null);
        const selected = multi ? Array.isArray(row.value) ? row.value : [] : row.value === '' || row.value === undefined ? [] : [row.value];
        const unavailable = selected.filter(value => !available.some(option => option.value === value)).map(value => ({ value, label: 'Previously selected value (unavailable)' }));
        const all = [...available, ...unavailable];
        const encode = value => value === null ? '__no_value__' : String(value);
        const decode = value => all.find(option => encode(option.value) === value).value;
        return <div className="form-group ticket-field"><label className="form-label" htmlFor={id}>{multi ? 'Values' : 'Value'}</label><select id={id} className="form-select" multiple={multi} value={multi ? selected.map(encode) : selected.length ? encode(selected[0]) : ''} onChange={event => onChange(multi ? [...event.target.selectedOptions].map(option => decode(option.value)) : event.target.value === '' ? '' : decode(event.target.value))}>
            {!multi && <option value="">Choose…</option>}{all.map(option => <option key={encode(option.value)} value={encode(option.value)} title={field.type !== 'account' && option.label.includes('(unavailable)') ? String(option.value) : undefined}>{option.label}</option>)}
        </select></div>;
    }
    const numeric = ['number', 'decimal'].includes(field.type);
    if (multi) return <label className="form-label mt-2" htmlFor={id}>Values, separated by commas<input id={id} className="form-control" value={Array.isArray(row.value) ? row.value.map(value => field.timestamp && typeof value === 'number' ? new Date(value).toISOString() : value).join(',') : row.value || ''} onChange={event => onChange(event.target.value.split(',').map(value => field.timestamp ? Date.parse(value) : numeric ? Number(value) : value.trim()))}/></label>;
    return <TicketField id={id} label={field.timestamp ? 'Value (UTC)' : 'Value'} required={false} field={{ ...field, options: undefined, type: field.timestamp ? 'datetime-local' : field.type === 'dropdown' ? 'text' : field.type }} value={field.timestamp && typeof row.value === 'number' ? new Date(row.value).toISOString().slice(0, 16) : row.value} onChange={value => onChange(field.timestamp ? Date.parse(`${value}Z`) : value)}/>;
}
