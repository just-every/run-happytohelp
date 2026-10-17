import React, { useState } from 'react';
import { Field } from '../forms';
import TicketField from '../../../dashboard/components/tickets/TicketField';
export default function RuleFieldActions({ values, fields, onChange, prefix }) {
    const [selected,setSelected]=useState('');
    return <>{Object.entries(values).map(([id,value])=>{const field=fields.find(row=>row.id===id);return <div key={id}>{field?<TicketField id={`${prefix}-${id}`} field={field} value={value} onChange={next=>onChange({...values,[id]:next})}/>:<p>Unavailable field: {id}</p>}<button type="button" onClick={()=>onChange(Object.fromEntries(Object.entries(values).filter(([key])=>key!==id)))}>Remove field update</button></div>;})}<Field name={`${prefix}-field`} label="Ticket field to update" value={selected} options={[{value:'',label:'Select field'},...fields.filter(row=>row.writable&&!Object.hasOwn(values,row.id)).map(row=>({value:row.id,label:row.name}))]} onChange={(_,id)=>{if(!id)return;const field=fields.find(row=>row.id===id);onChange({...values,[id]:field.type==='checkbox'?false:field.type==='multiselect'?[]:''});setSelected('');}}/></>;
}
