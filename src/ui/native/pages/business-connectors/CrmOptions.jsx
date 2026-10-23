import React from 'react';
export default function CrmOptions({prefix,connection,options,setOptions}){
 const mappings=JSON.parse(connection.fields_json||'{}'),object=options.object||'contact',fields=mappings[object==='account'?'editable_account':'editable_contact']||[],field=Object.keys(options.changes||{})[0]||'',record=object==='contact'?connection.link.context:connection.link.context?.accounts?.find(x=>x.id===options.record_id);
 return <>
  <label htmlFor={prefix+'crm-object'}>CRM record</label><select id={prefix+'crm-object'} className="form-select mb-2" value={object} onChange={e=>setOptions({object:e.target.value,changes:{}})}><option value="contact">Mapped contact</option><option value="account" disabled={!connection.link.context?.relationships_complete}>Related company or account</option></select>
  {object==='account'&&<><label htmlFor={prefix+'crm-account'}>Related account</label><select required id={prefix+'crm-account'} className="form-select mb-2" value={options.record_id||''} onChange={e=>setOptions(previous=>({...previous,record_id:e.target.value}))}><option value="">Choose a related account</option>{connection.link.context?.accounts?.map(x=><option key={x.id} value={x.id}>{x.name||x.id} · {x.id}</option>)}</select></>}
  <label htmlFor={prefix+'crm-field'}>Approved CRM field</label><select required id={prefix+'crm-field'} className="form-select mb-2" value={field} onChange={e=>setOptions(previous=>({...previous,changes:{[e.target.value]:''}}))}><option value="">Choose a configured field</option>{fields.map(x=><option key={x} value={x}>{x}</option>)}</select>
  {field&&<p>Current value: {String(record?.fields?.[field]??'Unavailable')}</p>}
  <label htmlFor={prefix+'crm-value'}>New field value</label><input id={prefix+'crm-value'} className="form-control mb-2" maxLength="2000" value={options.changes?.[field]??''} onChange={e=>setOptions(previous=>({...previous,changes:{[field]:e.target.value}}))}/>
 </>;
}
