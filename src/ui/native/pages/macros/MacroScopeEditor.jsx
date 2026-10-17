import React from 'react';
import {Field,Section} from '../forms';
export default function MacroScopeEditor({value,onChange,settings}){
 const set=(key,v)=>onChange({...value,[key]:v});
 const multi=(key,label,items)=><div className="form-group"><label htmlFor={`scope-${key}`} className="form-label">{label}</label><select id={`scope-${key}`} multiple className="form-select" value={value[key]} onChange={e=>set(key,[...e.target.selectedOptions].map(o=>o.value))}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Leave empty for all permitted {label.toLowerCase()}.</small></div>;
 return <Section title="Access" description="Current permissions, role, group membership and brand are checked whenever a macro is used."><Field name="macro-visibility" label="Visibility" value={value.visibility} onChange={(_,v)=>set('visibility',v)} options={['personal','group','shared']}/><div className="settings-grid">{multi('roles','Roles',settings.roles.filter(r=>r.id!=='api'))}{multi('groups','Groups',settings.groups)}{multi('brands','Brands',settings.brands)}</div></Section>;
}
