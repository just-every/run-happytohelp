import React from 'react';
import {dateTime,label} from './workflow-model';
import {comparison,fieldName} from './rule-language';
const names={conditions:'Conditions',all:'All required conditions',any:'Alternative conditions',event_matches:'Event matches',time:'Timing',matched:'Requirement met',due_at:'Due',explanation:'Reason',conflict_order:'Rule order',stop_condition:'Stop after this rule',routing:'Routing',field:'Ticket field',op:'Comparison'};
export default function RuleExplanation({value,settings={}}) {
 if(value==null)return null;
 const render=value=><RuleExplanation value={value} settings={settings}/>;
 if(typeof value==='string'){
  if(value.startsWith('{')||value.startsWith('[')){try{return render(JSON.parse(value));}catch{}}
  return <span>{value}</span>;
 }
 if(typeof value==='boolean')return <span>{value?'Yes':'No'}</span>;
 if(typeof value==='number')return <span>{new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(value)}</span>;
 if(Array.isArray(value))return value.length?<ul>{value.map((row,index)=><li key={index}>{render(row)}</li>)}</ul>:<span>None</span>;
 if(value.field&&value.op)return <span>{fieldName(value.field,settings)} {comparison[value.op]||label(value.op)}: {value.matched?'Matched':'Not matched'}</span>;
 return <dl className="workflow-explanation">{Object.entries(value).map(([key,detail])=><React.Fragment key={key}><dt>{names[key]||label(key)}</dt><dd>{key==='due_at'&&typeof detail==='number'?dateTime(detail):key==='field'?fieldName(detail,settings):render(detail)}</dd></React.Fragment>)}</dl>;
}
