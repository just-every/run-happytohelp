import React from 'react';
import TicketFilterValue from './TicketFilterValue';
import { tooltip } from '../../../../modules/tooltip/tooltip';
const operatorLabels = { eq: 'Equals', ne: 'Does not equal', in: 'Is any of', not_in: 'Is none of', is_empty: 'Is empty', is_not_empty: 'Is not empty', gt: 'Greater than', gte: 'At least', lt: 'Less than', lte: 'At most', contains: 'Contains' };

export default function TicketViewRules({ fields, filters, sort, onChange, projectId, contacts = [] }) {
    const options = fields.map(field => <option key={field.value} value={field.value}>{field.label}</option>);
    const updateFilter = (index, patch) => onChange({ filters: filters.map((row, at) => at === index ? { ...row, ...patch } : row) });
    return <>
        <div className="form-label mt-2">Match every filter</div>
        {filters.map((row, index) => {
            const field = fields.find(item => item.value === row.field) || fields[0];
            const numeric = ['number', 'decimal'].includes(field.type);
            const ordered = numeric || field.type === 'date';
            const operators = ['eq', 'ne', 'in', 'not_in', 'is_empty', 'is_not_empty', ...(ordered ? ['gt', 'gte', 'lt', 'lte'] : field.type === 'checkbox' ? [] : ['contains'])];
            return <div className="ticket-rule" key={index}><div className="ticket-rule-row">
                <select className="form-select" aria-label={`Filter ${index + 1} field`} value={row.field} onChange={event => updateFilter(index, { field: event.target.value, operator: 'eq', value: fields.find(field => field.value === event.target.value).type === 'checkbox' ? false : '' })}>{options}</select>
                <select className="form-select" aria-label={`Filter ${index + 1} operator`} value={row.operator} onChange={event => updateFilter(index, { operator: event.target.value, value: ['in', 'not_in'].includes(event.target.value) ? [] : field.type === 'checkbox' ? false : '' })}>{operators.map(value => <option key={value} value={value}>{operatorLabels[value]}</option>)}</select>
                <button className="btn btn-sm btn-link" type="button" {...tooltip('Remove filter')} onClick={() => onChange({ filters: filters.filter((_, at) => at !== index) })}>×</button>
            </div>{!['is_empty', 'is_not_empty'].includes(row.operator) && <TicketFilterValue {...{field, row, index, projectId, contacts}} onChange={value => updateFilter(index, { value })}/>}</div>;
        })}
        <button className="btn btn-sm btn-link" type="button" onClick={() => onChange({ filters: [...filters, { field: fields[0].value, operator: 'eq', value: '' }] })}>Add filter</button>
        <div className="form-label mt-2">Sort in this order</div>
        {sort.map((row, index) => <div className="ticket-rule-row mt-2" key={index}>
            <select className="form-select" aria-label={`Sort ${index + 1} field`} value={row.field} onChange={event => onChange({ sort: sort.map((item, at) => at === index ? { ...item, field: event.target.value } : item) })}>{options}</select>
            <select className="form-select" aria-label={`Sort ${index + 1} direction`} value={row.direction} onChange={event => onChange({ sort: sort.map((item, at) => at === index ? { ...item, direction: event.target.value } : item) })}><option value="asc">Ascending</option><option value="desc">Descending</option></select>
            <button className="btn btn-sm btn-link" type="button" {...tooltip('Remove sort')} onClick={() => onChange({ sort: sort.filter((_, at) => at !== index) })}>×</button>
        </div>)}
        <button className="btn btn-sm btn-link" type="button" onClick={() => onChange({ sort: [...sort, { field: 'updated_at', direction: 'desc' }] })}>Add sort</button>
    </>;
}
