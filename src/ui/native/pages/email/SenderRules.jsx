import React, {useEffect, useId, useState} from 'react';
import {Field} from '../forms';
import {nativeRequest} from '../../transport';

export const senderDomain = address => {
 const domain=String(address||'').trim().split('@')[1];
 return domain&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(domain)?`@${domain.toLowerCase()}`:null;
};
const validRule = value => /^@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(value)||/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value);

export default function SenderRules({projectId,revision,busy,onRule}) {
 const [address,setAddress]=useState(''),[action,setAction]=useState('block'),[error,setError]=useState('');const id=useId();
 const [rules,setRules]=useState([]);
 useEffect(()=>{const controller=new AbortController();nativeRequest(`/api/management/projects/${encodeURIComponent(projectId)}/sender-rules`,{signal:controller.signal}).then(result=>setRules(result.data)).catch(failure=>{if(!controller.signal.aborted)setError(failure.message)});return()=>controller.abort();},[projectId,revision]);
 const save=()=>{const value=address.trim().toLowerCase();if(!validRule(value)){setError('Enter one email address or a domain beginning with @.');return;}setError('');onRule(value,action);};
 return <fieldset className="email-editor" disabled={busy}><legend>Sender rules</legend>
  <div className="settings-grid"><Field name={`${id}-sender`} label="Email address or @domain" value={address} onChange={(_,value)=>setAddress(value)} hint="For example, sender@example.com or @example.com."/><Field name={`${id}-action`} label="Action" value={action} onChange={(_,value)=>setAction(value)} options={[{value:'block',label:'Block'},{value:'allow',label:'Allow'},{value:'remove',label:'Remove rule'}]}/></div>
  {error&&<p role="alert" className="text-danger">{error}</p>}
  <div className="email-actions"><button type="button" className="btn btn-white" onClick={save}>Apply sender rule</button></div>
  <p className="settings-note">Rules affect future mail. Allowing an address or domain does not prove sender authentication or recover held mail.</p>
  <ul className="email-addresses" aria-label="Current sender rules">{rules.map(rule=><li key={rule.address}><span>{rule.address} · {rule.action==='block'?'Blocked':'Allowed'}</span><button type="button" className="btn btn-link" onClick={()=>onRule(rule.address,'remove')}>Remove rule for {rule.address}</button></li>)}</ul>
 </fieldset>;
}
