import React from 'react';
import TicketField from './tickets/TicketField';
import {Field} from '../../native/pages/forms';
export function activeTicketFields(settings,forms,draft){
 const form=forms.find(form=>form.id===draft.formId),fields=settings?.fields||[];
 return (form?form.fields.map(ref=>({...fields.find(field=>field.id===ref.fieldId),...ref,required:ref.required})):fields.filter(field=>field.writable).map(field=>({...field,required:false}))).filter(field=>{
  if(!field.id)return false;const c=field.condition;if(!c)return true;const value=draft.fields[c.fieldId];if(c.operator==='present')return value!==undefined&&value!==null&&value!=='';if(value===undefined||value===null||value==='')return false;if(c.operator==='includes')return Array.isArray(value)&&value.includes(c.value);return c.operator==='equals'?value===c.value:value!==c.value;
 });
}
export default function CreateTicketConfiguration({settings,forms,agents,draft,change}){
 if(!settings)return <p role="status">Loading ticket choices…</p>;
 const fields=activeTicketFields(settings,forms,draft);
 return <><Field name="new-ticket-brand" label="Brand" value={draft.brandId} options={settings.brands.map(row=>({value:row.id,label:row.name}))} onChange={(_,value)=>change('brandId',value)}/><div className="settings-grid"><Field name="new-ticket-group" label="Group" value={draft.groupId} options={[{value:'',label:'No group'},...settings.groups.map(row=>({value:row.id,label:row.name}))]} onChange={(_,value)=>change('groupId',value)}/><Field name="new-ticket-assignee" label="Assignee" value={draft.assigneeId} options={[{value:'',label:'You (default)'},{value:'unassigned',label:'Unassigned'},...agents.filter(agent=>!draft.groupId||settings.groups.find(group=>group.id===draft.groupId)?.members.includes(agent.id)).map(row=>({value:row.id,label:row.name||row.email}))]} onChange={(_,value)=>change('assigneeId',value)}/></div><Field name="new-ticket-form" label="Ticket form" value={draft.formId} options={[{value:'',label:'No form'},...forms.filter(form=>form.enabled).map(row=>({value:row.id,label:row.title}))]} onChange={(_,value)=>{change('formId',value);change('fields',{});}}/>{fields.map(field=><TicketField key={field.id} id={`new-ticket-field-${field.id}`} field={field} value={draft.fields[field.id]} required={field.required} onChange={value=>change('fields',{...draft.fields,[field.id]:value})}/>)}</>;
}
