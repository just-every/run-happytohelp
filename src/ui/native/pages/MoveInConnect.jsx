import React,{useState} from 'react';
import {nativeRequest} from '../transport';
import {Feedback,Field,Section} from './forms';
import './move-in-api.css';

export const apiVendors={zendesk:'Zendesk',intercom:'Intercom',helpscout:'Help Scout',freshdesk:'Freshdesk'};
const emptyCredentials=()=>({domain:'',email:'',token:'',docsToken:''});

/** Credentials belong only to this form until the installation accepts the connection. */
export default function MoveInConnect({projectId,busy,onBusy,onRun,connectionId,sourceVendor,onReconnect}){
 const [vendor,setVendor]=useState(sourceVendor||'zendesk'),[credentials,setCredentials]=useState(emptyCredentials),[error,setError]=useState('');
 const change=(name,value)=>setCredentials(old=>({...old,[name]:value}));
 const connect=async event=>{
  event.preventDefault();onBusy(true);setError('');
  const body={vendor,token:credentials.token};
  if(vendor==='zendesk'||vendor==='freshdesk')body.domain=credentials.domain.trim();
  if(vendor==='zendesk')body.email=credentials.email.trim();
  if(vendor==='helpscout')body.docsToken=credentials.docsToken;
  try{
   const path=`/api/move-in/projects/${projectId}/import-connections${connectionId?`/${connectionId}/reconnect`:""}`;
   const result=await nativeRequest(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   setCredentials(emptyCredentials());
   if(connectionId)await onReconnect();else onRun(result.data);
  }catch(e){
   setError(e.message);
  }finally{onBusy(false)}
 };
 return <Section title={connectionId?`Reconnect ${apiVendors[vendor]}`:"Connect your help desk"}><div className="move-in-api"><p>{connectionId?"Supply current credentials for the same source account, then resume this import. Reconnecting replaces the stored credentials and keeps this run’s progress.":"Connect once to fetch your history, review it here, then approve the import. Your existing help desk keeps receiving messages until you change its channels."}</p><Feedback error={error}/><form onSubmit={connect} autoComplete="off">
  {!connectionId&&<Field name="move-in-api-vendor" label="Help desk" value={vendor} options={Object.entries(apiVendors).map(([value,label])=>({value,label}))} onChange={(_,value)=>{setVendor(value);setCredentials(emptyCredentials());setError('')}}/>}
  {(vendor==='zendesk'||vendor==='freshdesk')&&<Field name={connectionId?`move-in-api-${connectionId}-domain`:"move-in-api-domain"} label={`${apiVendors[vendor]} domain`} value={credentials.domain} required placeholder={`yourcompany.${vendor}.com`} onChange={(_,value)=>change('domain',value)} hint={`Enter your account’s ${vendor}.com domain.`}/>}
  {vendor==='zendesk'&&<Field name={connectionId?`move-in-api-${connectionId}-email`:"move-in-api-email"} label="Zendesk admin email" type="email" value={credentials.email} required onChange={(_,value)=>change('email',value)}/>}
  <Field name={connectionId?`move-in-api-${connectionId}-token`:"move-in-api-token"} label={vendor==='zendesk'?'API token':vendor==='freshdesk'?'API key':vendor==='helpscout'?'Inbox OAuth access token':'Access token'} type="password" value={credentials.token} required onChange={(_,value)=>change('token',value)}/>
  {vendor==='helpscout'&&<Field name={connectionId?`move-in-api-${connectionId}-docs-token`:"move-in-api-docs-token"} label="Docs API key" type="password" value={credentials.docsToken} required onChange={(_,value)=>change('docsToken',value)} hint="Help Scout Docs uses a separate API key. The Inbox token cannot read your Docs articles."/>}
  <p className="settings-note"><a href={`/docs/move-from-${vendor}`}>Get your {apiVendors[vendor]} credentials and check permissions</a>. Secrets are cleared from this form after connecting, never shown again, and excluded from exports.</p>
  <p className="settings-note">Fetching, importing, final sync, agent mapping and completing cutover send no messages or notifications and invite no staff. Downloaded attachments are stored privately in this installation; failed files are listed for review.</p>
  <button className="btn btn-primary" disabled={busy}>{busy?'Working…':connectionId?'Reconnect source':'Connect and fetch history'}</button>
 </form></div></Section>;
}
