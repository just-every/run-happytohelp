export const blankForm = () => ({ title: '', description: '', submitLabel: 'Submit request', locale: 'en', enabled: false, fields: [], translations: {} });
export const jsonRequest = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const formPath = projectId => `/api/forms/projects/${encodeURIComponent(projectId)}/forms`;
export const fieldName = (fields, id) => fields.find(field => field.id === id)?.name || 'Unavailable field';
export const validOrder = fields => fields.every((field, index) => !field.condition || fields.slice(0, index).some(prior => prior.fieldId === field.condition.fieldId));
export function movedFields(fields, index, offset) {
    const next = [...fields];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    return next;
}
export function conditionValue(field, value) {
    if (field?.type === 'checkbox') return value === true || value === 'true';
    if (['number', 'decimal'].includes(field?.type)) return value === '' ? '' : Number(value);
    return typeof value === 'object' && value !== null ? value.value : value;
}
