export const categories = ['new', 'open', 'pending', 'on_hold', 'solved', 'closed'];
export const priorities = ['low', 'normal', 'high', 'urgent'];
export const label = value => String(value || '').replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());
export const ticketPath = projectId => `/api/dashboard/projects/${encodeURIComponent(projectId)}`;
export const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const fieldOptions = field => (field.type === 'account' ? field.accountOptions || [] : field.options || []).map(option => typeof option === 'string' ? { value: option, label: option } : { value: option.value, label: option.label || option.value, disabled: option.disabled });
export function typedValue(field, value) {
    if (value === '' && ['number', 'decimal', 'date'].includes(field.type)) return null;
    if (['number', 'decimal'].includes(field.type)) return Number(value);
    return value;
}
export function queueFields(settings, agents = [], tags = [], contacts = []) {
    const named = rows => rows.map(row => ({ value: row.id, label: row.name || row.display_name || row.email }));
    const choices = values => values.map(value => ({ value, label: label(value) }));
    const fields = [
        { value: 'id', label: 'Ticket reference', type: 'text' },
        { value: 'status_id', label: 'Status', options: named(settings.statuses) },
        { value: 'status_category', label: 'Status category', options: choices(categories) },
        { value: 'priority', label: 'Priority', options: choices(priorities) },
        { value: 'assigned_to', label: 'Assignee', options: [{ value: null, label: 'Unassigned' }, ...named(agents)] },
        { value: 'subject', label: 'Subject', type: 'text' },
        { value: 'channel', label: 'Channel', type: 'text' },
        { value: 'brand_id', label: 'Brand', options: named(settings.brands) },
        { value: 'group_id', label: 'Group', options: [{ value: null, label: 'No group' }, ...named(settings.groups)] },
        { value: 'requester_id', label: 'Requester', type: 'text', identity: 'contact' },
        { value: 'submitter_id', label: 'Submitter', options: [{ value: 'system', label: 'System' }, ...named(agents), ...contacts.map(contact => ({ value: contact.id, label: contact.provided_name || contact.name || contact.display_name || contact.provided_email || contact.email || 'Unnamed contact' }))] },
        { value: 'submitter_type', label: 'Submitter type', options: choices(['contact', 'agent', 'system']) },
        { value: 'tags', label: 'Tags', type: 'multiselect', options: named(tags) },
        { value: 'created_at', label: 'Created', type: 'date', timestamp: true },
        { value: 'updated_at', label: 'Updated', type: 'date', timestamp: true },
        { value: 'ticket_version', label: 'Ticket version', type: 'number' },
    ];
    return [...fields.map(field => ({ ...field, type: field.type || 'dropdown' })),
        ...settings.fields.map(field => ({ ...field, value: `custom:${field.id}`, label: field.name }))];
}
