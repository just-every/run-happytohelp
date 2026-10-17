import { csv } from './workflow-model';
function conditionValue(row, settings) {
    if (row.op === 'exists') return {field:row.field,op:row.op};
    const field = settings.fields.find(field => `field:${field.id}` === row.field);
    const numeric = ['number','decimal'].includes(field?.type);
    let value = row.value;
    if (['in','not_in'].includes(row.op)) {
        value = (Array.isArray(value) ? value : csv(value)).map(part => String(part).trim()).filter(Boolean);
        if (numeric) value = value.map(Number);
    } else if (numeric || ['gte','lte'].includes(row.op)) value = Number(value);
    if (row.field==='assigned_to' && value==='') value=null;
    if (numeric && (Array.isArray(value) ? value.some(part=>!Number.isFinite(part)) : !Number.isFinite(value))) throw new Error('Numeric field conditions must contain valid numbers.');
    return {field:row.field,op:row.op,value};
}
export function rulePayload(draft, settings) {
    const body = {
        name:draft.name,kind:draft.kind,position:draft.position,
        conditions:Object.fromEntries(['all','any'].map(group => [group,(draft.conditions?.[group]||[]).map(row => conditionValue(row,settings))])),
        actions:draft.actions.map(row => row.type==='tags' ? {...row,add:csv(row.add?.join(',')),remove:csv(row.remove?.join(','))} : row),
    };
    if (draft.kind==='time') body.time={field:'status_changed_at',hours:48,...draft.time};
    else body.event_kind=draft.event_kind||'created';
    if (draft.kind==='routing') body.routing={strategy:'round_robin',...draft.routing,skills:csv(draft.routing?.skills?.join(','))};
    return body;
}
