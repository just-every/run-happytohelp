import React from 'react';
import { dateTime, label } from './workflow-model';
export default function RuleExplanation({ value }) {
    if(value==null)return null;
    if(typeof value==='string'){
        if(value.startsWith('{')||value.startsWith('[')){try{return <RuleExplanation value={JSON.parse(value)}/>;}catch{}}
        return <span>{value}</span>;
    }
    if(typeof value==='boolean')return <span>{value?'Yes':'No'}</span>;
    if(typeof value==='number')return <span>{value}</span>;
    if(Array.isArray(value))return <ul>{value.map((row,index)=><li key={index}><RuleExplanation value={row}/></li>)}</ul>;
    return <dl className="workflow-explanation">{Object.entries(value).map(([key,detail])=><React.Fragment key={key}><dt>{label(key)}</dt><dd>{key==='due_at'&&typeof detail==='number'?dateTime(detail):<RuleExplanation value={detail}/>}</dd></React.Fragment>)}</dl>;
}
