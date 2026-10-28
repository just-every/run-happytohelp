import React from 'react';
import TicketField from './tickets/TicketField';

export function activeTicketFields(form,values) {
 if(!form)return [];
 const accepted={};
 return form.fields.filter(field=>{
  const c=field.condition,value=c&&accepted[c.fieldId],source=c&&form.fields.find(f=>f.id===c.fieldId);
  const present=value!==undefined&&value!==null&&value!==''&&(!Array.isArray(value)||value.length>0);
  const visible=!c||!(source?.type==='account'&&c.operator!=='present'&&c.value==='')&&(c.operator==='present'?present:present&&(c.operator==='includes'?Array.isArray(value)&&value.includes(c.value):c.operator==='equals'?value===c.value:value!==c.value));
  if(visible)accepted[field.id]=values[field.id];
  return visible;
 });
}
export default function NewTicketConfiguration({draft,options,change,errorField,error}) {
 if(!options)return <p role="status">Loading ticket choices…</p>;
 const form=options.forms.find(form=>form.id===draft.formId),group=options.groups.find(group=>group.id===draft.groupId),members=options.members.filter(member=>!group||group.members.includes(member.id));
 const setField=(id,value)=>{
  const fields={...draft.fields,[id]:value};
  if(form){const active=new Set(activeTicketFields(form,fields).map(field=>field.id));for(const key of Object.keys(fields))if(!active.has(key))delete fields[key];}
  change('fields',fields);
 };
 const fields=form?activeTicketFields(form,draft.fields):options.fields.map(field=>({...field,label:field.name}));
 return <section aria-label="Ticket configuration">
  <div className="form-group"><label className="form-label" htmlFor="new-ticket-formId">Request form</label><select id="new-ticket-formId" className="form-select" value={draft.formId||''} onChange={event=>change('formId',event.target.value)}><option value="">No request form</option>{options.forms.map(form=><option key={form.id} value={form.id}>{form.title}</option>)}</select>{!options.forms.length&&<p className="form-text">No request forms are available.</p>}</div>
  {fields.map(field=><div key={field.id}><TicketField field={{...field,name:field.label,accountOptions:options.accounts}} value={draft.fields[field.id]} onChange={value=>setField(field.id,value)} id={`new-ticket-field-${field.id}`} label={field.label}/>{field.type==='account'&&!options.accounts.length&&<p className="form-text">Select an existing requester with verified native account membership to choose an account.</p>}{errorField===field.id&&<p className="text-danger" role="alert">{error}</p>}</div>)}
  <div className="settings-grid">
   <div className="form-group"><label className="form-label" htmlFor="new-ticket-groupId">Group</label><select id="new-ticket-groupId" className="form-select" value={draft.groupId||''} onChange={event=>change('groupId',event.target.value||null)}><option value="">No group</option>{options.groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></div>
   <div className="form-group"><label className="form-label" htmlFor="new-ticket-assigneeId">Assignee</label><select id="new-ticket-assigneeId" className="form-select" value={draft.assigneeId===undefined?options.actorId:draft.assigneeId||''} onChange={event=>change('assigneeId',event.target.value||null)}><option value="">Unassigned</option>{members.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select>{group&&!members.length&&<p className="form-text">This group has no current teammates. Choose Unassigned.</p>}</div>
  </div>
 </section>;
}
