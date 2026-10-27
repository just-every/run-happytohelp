import React from 'react';
import {Field,Section} from '../forms';
const unchanged={value:'__unchanged__',label:'Leave unchanged'};
export default function MacroActionsEditor({value,onChange,settings,members,tags,attachments}){
 const set=(key,next)=>{const copy={...value};if(next==='__unchanged__')delete copy[key];else copy[key]=next==='__none__'?null:next;onChange(copy)};
 const select=(key,label,items,clear=false)=><Field name={`macro-${key}`} label={label} value={value[key]===null?'__none__':value[key]??'__unchanged__'} onChange={(_,v)=>set(key,v)} options={[unchanged,...(clear?[{value:'__none__',label:'Unassigned'}]:[]),...items]}/>;
 const multi=(key,label,items)=><div className="form-group"><label className="form-label" htmlFor={`macro-${key}`}>{label}</label><select id={`macro-${key}`} multiple className="form-select" value={value[key]??[]} onChange={e=>set(key,[...e.target.selectedOptions].map(o=>o.value))}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div>;
 return <Section title="Actions" description="Every change is previewed before the macro is applied. Reply text is put in the composer for editing."><div className="settings-grid">
  {select('status_id','Status',settings.statuses.filter(s=>s.active).map(s=>({value:s.id,label:s.name})))}
  {select('priority','Priority',['low','normal','high','urgent'].map(value=>({value,label:value})))}
  {select('group_id','Group',settings.groups.map(g=>({value:g.id,label:g.name})),true)}
  {select('agent_id','Assignee',members.filter(m=>!m.pending).map(m=>({value:m.id,label:m.name})),true)}
  {multi('tags_add','Add tags',tags)}{multi('tags_remove','Remove tags',tags)}
  <div>{multi('followers','Followers',members.filter(m=>!m.pending))}<button type="button" className="btn btn-sm btn-white" onClick={()=>set('followers','__unchanged__')}>Leave followers unchanged</button>{value.followers&&<small className="d-block">Replaces the follower list; no selection clears it.</small>}</div>
 </div><MacroFields fields={settings.fields} values={value.fields??{}} onChange={fields=>set('fields',fields)}/>
 <div className="form-group"><label htmlFor="macro-attachments" className="form-label">Attachments</label><select id="macro-attachments" className="form-select" multiple value={value.attachments??[]} onChange={e=>set('attachments',[...e.target.selectedOptions].map(o=>o.value))}>{attachments.map(file=><option key={file.id} value={file.id}>{file.filename}{file.subject?` — ${file.subject}`:''}</option>)}</select><p className="form-text">Choose files you previously uploaded to a ticket. Each use creates a separate attachment for the ticket being updated.</p></div>
 </Section>;
}
function MacroFields({fields,values,onChange}){
 return <fieldset className="macro-fields"><legend className="fs-6">Custom ticket fields</legend>{fields.filter(f=>f.writable).map(field=>{
  const enabled=Object.hasOwn(values,field.id),set=value=>onChange({...values,[field.id]:value});
  return <div key={field.id} className="mb-3"><div className="form-check"><input id={`set-${field.id}`} type="checkbox" className="form-check-input" checked={enabled} onChange={e=>{const copy={...values};if(e.target.checked)copy[field.id]=field.type==='checkbox'?false:field.type==='multiselect'?[]:'';else delete copy[field.id];onChange(copy)}}/><label htmlFor={`set-${field.id}`} className="form-check-label">Set {field.name}</label></div>{enabled&&(field.type==='multiselect'?<select aria-label={field.name} multiple className="form-select" value={values[field.id]??[]} onChange={e=>set([...e.target.selectedOptions].map(o=>o.value))}>{field.options.map(o=><option key={o}>{o}</option>)}</select>:<Field name={`field-${field.id}`} label={field.name} type={field.type==='checkbox'?'checkbox':['number','decimal'].includes(field.type)?'number':field.type==='date'?'date':'text'} step={field.type==='decimal'?'any':undefined} options={field.type==='account'?[{value:'',label:'Choose an account'},...(field.accountOptions??[]).filter(option=>!option.disabled)]:field.type==='dropdown'?['',...field.options]:undefined} value={values[field.id]} onChange={(_,value)=>set(value)}/>)}{enabled&&!field.required&&<button type="button" className="btn btn-sm btn-white" onClick={()=>set(null)}>Clear value</button>}</div>
 })}</fieldset>;
}
