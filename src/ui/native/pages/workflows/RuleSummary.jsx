import React from 'react';
import { label } from './workflow-model';
export function actionDescription(action, settings, agents) {
    const name=(rows,id)=>rows.find(row=>row.id===id)?.name||id;
    if(action.type==='status')return `Set status: ${name(settings.statuses,action.status_id)}`;
    if(action.type==='priority')return `Set priority: ${label(action.priority)}`;
    if(action.type==='assign')return `Assign: ${action.user_id?name(agents,action.user_id):'Unassigned'}${action.group_id?` · ${name(settings.groups,action.group_id)}`:''}`;
    if(action.type==='tags')return `Tags: add ${(action.add||[]).join(', ')||'none'}; remove ${(action.remove||[]).join(', ')||'none'}`;
    if(action.type==='notify')return `Notify ${label(action.kind)}${action.message?`: ${action.message}`:''}`;
    if(action.type==='note')return `Internal note: ${action.content}`;
    if(action.type==='fields')return `Update fields: ${Object.keys(action.values||{}).map(id=>name(settings.fields,id)).join(', ')}`;
    return action.type==='route'?'Route to an eligible operator':label(action.type);
}
export default function RuleSummary({ definition, settings, agents }) {
    if(!definition)return null;
    return <><p className="settings-note">{definition.kind==='time'?`After ${definition.time?.hours} hours from ${label(definition.time?.field)}`:`When ${label(definition.event_kind||'created')}`}{definition.routing&&` · Routing: ${label(definition.routing.strategy)}`}</p>{['all','any'].map(group=>(definition.conditions?.[group]?.length>0)&&<p className="settings-note" key={group}>{group==='all'?'All':'Any'}: {definition.conditions[group].map(row=>`${label(row.field)} ${label(row.op)}${row.op==='exists'?'':` ${Array.isArray(row.value)?row.value.join(', '):String(row.value??'')}`}`).join('; ')}</p>)}<ul className="settings-note">{definition.actions?.map((action,index)=><li key={index}>{actionDescription(action,settings,agents)}</li>)}</ul></>;
}
