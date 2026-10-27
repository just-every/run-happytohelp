import React from 'react';
import { Field } from '../forms';
import { conditionValue } from './form-model';

const initialValue = field => field?.type === 'account' ? '' : conditionValue(field, field?.options?.[0] ?? (field?.type === 'checkbox' ? true : ''));

export default function ConditionEditor({ id, condition, previous, definitions, onChange }) {
    const source = definitions.find(field => field.id === condition?.fieldId);
    const available = previous.map(field => definitions.find(definition => definition.id === field.fieldId)).filter(Boolean);
    const update = (key, value) => onChange({ ...condition, [key]: value });
    const operators = source?.type === 'multiselect' ? [{ value: 'includes', label: 'Includes' }, { value: 'present', label: 'Has a value' }] : [{ value: 'equals', label: 'Equals' }, { value: 'not_equals', label: 'Does not equal' }, { value: 'present', label: 'Has a value' }];
    const options = source?.type === 'checkbox' ? [{ value: 'true', label: 'Checked' }, { value: 'false', label: 'Unchecked' }] : source?.type === 'account' ? [{value:'',label:'Choose an account'}, ...(source.accountOptions || [])] : source?.options?.length ? source.options : undefined;
    return <div className="request-form-condition">
        <Field name={`${id}-conditional`} label="Show only when a condition matches" type="checkbox" value={Boolean(condition)} onChange={(_, checked) => onChange(checked ? { fieldId: available[0].id, operator: available[0].type === 'multiselect' ? 'includes' : 'equals', value: initialValue(available[0]) } : undefined)}/>
        {condition && <div className="request-form-condition__controls">
            <Field name={`${id}-condition-field`} label="Condition field" value={condition.fieldId} options={available.map(field => ({ value: field.id, label: field.name }))} onChange={(_, fieldId) => { const field = definitions.find(item => item.id === fieldId); onChange({ fieldId, operator: field.type === 'multiselect' ? 'includes' : 'equals', value: initialValue(field) }); }}/>
            <Field name={`${id}-condition-operator`} label="Condition operator" value={condition.operator} options={operators} onChange={(_, operator) => onChange(operator === 'present' ? { fieldId: condition.fieldId, operator } : { ...condition, operator, value: initialValue(source) })}/>
            {condition.operator !== 'present' && <Field name={`${id}-condition-value`} label="Condition value" required={source?.type !== 'account'} value={String(condition.value ?? '')} options={options} type={['number', 'decimal'].includes(source?.type) ? 'number' : source?.type === 'date' ? 'date' : 'text'} step={source?.type === 'decimal' ? 'any' : undefined} onChange={(_, value) => update('value', conditionValue(source, value))}/>}
        </div>}
        <p className="settings-note">A required field must be filled in only when it is shown. Conditions use a field placed earlier in this form.</p>
    </div>;
}
