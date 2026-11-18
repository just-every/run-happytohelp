import React from 'react';
import {Field,Section} from '../forms';
export default function MacroScopeEditor({value,onChange,settings}){
 const set=(key,v)=>onChange({...value,[key]:v});
 const multi=(key,label,items)=><div className="form-group"><label htmlFor={`scope-${key}`} className="form-label">{label}</label><select id={`scope-${key}`} multiple className="form-select" value={value[key]} onChange={e=>set(key,[...e.target.selectedOptions].map(o=>o.value))}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Leave empty for all permitted {label.toLowerCase()}.</small></div>;
 return <Section title="Access" description="Choose which roles, groups and brands can use this saved reply."><div className="settings-grid">{multi('roles','Roles',settings.roles.filter(r=>r.id!=='api').map(r=>({...r,name:({owner:'Owner',admin:'Admin',operator:'Agent',collaborator:'Collaborator'})[r.id]||r.name})))}{multi('groups','Groups',settings.groups)}{multi('brands','Brands',settings.brands)}</div></Section>;
}
