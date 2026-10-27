import React from 'react';
import { Field } from '../forms';
import { conditionValue } from './form-model';

export default function ConditionEditor({ id, condition, previous, definitions, onChange }) {
    const source = definitions.find(field => field.id === condition?.fieldId);
    const available = previous.map(field => definitions.find(definition => definition.id === field.fieldId)).filter(Boolean);
    const update = (key, value) => onChange({ ...condition, [key]: value });
    const operators = source?.type === 'multiselect' ? [{ value: 'includes', label: 'Includes' }, { value: 'present', label: 'Has a value' }] : [{ value: 'equals', label: 'Equals' }, { value: 'not_equals', label: 'Does not equal' }, { value: 'present', label: 'Has a value' }];
    const options = source?.type === 'checkbox' ? [{ value: 'true', label: 'Checked' }, { value: 'false', label: 'Unchecked' }] : source?.type === 'account' ? [{value:'',label:'Choose an account'}, ...(source.accountOptions || [])] : source?.options?.length ? source.options : undefined;
    return <div className="request-form-condition">
        <Field name={`${id}-conditional`} label="Show only when a condition matches" type="checkbox" value={Boolean(condition)} onChange={(_, checked) => onChange(checked ? { fieldId: available[0].id, operator: available[0].type === 'multiselect' ? 'includes' : 'equals', value: conditionValue(available[0], (available[0].accountOptions || available[0].options)?.[0] ?? (available[0].type === 'checkbox' ? true : '')) } : undefined)}/>
        {condition && <div className="request-form-condition__controls">
            <Field name={`${id}-condition-field`} label="Condition field" value={condition.fieldId} options={available.map(field => ({ value: field.id, label: field.name }))} onChange={(_, fieldId) => { const field = definitions.find(item => item.id === fieldId); onChange({ fieldId, operator: field.type === 'multiselect' ? 'includes' : 'equals', value: conditionValue(field, (field.accountOptions || field.options)?.[0] ?? (field.type === 'checkbox' ? true : '')) }); }}/>
            <Field name={`${id}-condition-operator`} label="Condition operator" value={condition.operator} options={operators} onChange={(_, operator) => onChange(operator === 'present' ? { fieldId: condition.fieldId, operator } : { ...condition, operator, value: conditionValue(source, (source?.accountOptions || source?.options)?.[0] ?? (source?.type === 'checkbox' ? true : '')) })}/>
            {condition.operator !== 'present' && <Field name={`${id}-condition-value`} label="Condition value" required value={String(condition.value ?? '')} options={options} type={['number', 'decimal'].includes(source?.type) ? 'number' : source?.type === 'date' ? 'date' : 'text'} step={source?.type === 'decimal' ? 'any' : undefined} onChange={(_, value) => update('value', conditionValue(source, value))}/>}
        </div>}
        <p className="settings-note">A required field must be filled in only when it is shown. Conditions use a field placed earlier in this form.</p>
    </div>;
}
