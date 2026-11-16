import {label} from './workflow-model';
const fields={status_id:'Status',status_category:'Status category',brand_id:'Brand',group_id:'Queue',assigned_to:'Assigned teammate',requester_id:'Customer',form_id:'Request form',pending_at:'Marked pending',on_hold_at:'Put on hold',solved_at:'Solved',created_at:'Created',updated_at:'Last updated',last_customer_reply_at:'Last customer reply',last_operator_reply_at:'Last teammate reply',sla_due_at:'SLA deadline'};
export const comparison={eq:'equals',neq:'does not equal',in:'is one of',not_in:'is not one of',exists:'has a value',gte:'is at least',lte:'is at most',contains:'contains'};
export const fieldName=(field,settings={})=>field?.startsWith('field:')?(settings.fields||[]).find(row=>row.id===field.slice(6))?.name||'Custom field':fields[field]||label(field);
export function conditionValue(field,value,settings,agents){
 const rows={status_id:settings.statuses,brand_id:settings.brands,group_id:settings.groups,assigned_to:agents,tags:settings.tags}[field];
 const name=value=>rows?rows.find(row=>row.id===value)?.name||(value?'Unavailable selection':'Unassigned'):label(String(value??''));
 return Array.isArray(value)?value.map(name).join(', '):name(value);
}
