import React, {useId, useState} from 'react';
import {Field} from '../forms';
import {jsonBody} from './mail-api';

/** Independent controls inside ProjectSettings' form; never submits the parent. */
export default function MailboxEditor({act,oauth,socketHosts,socketPorts,busy,onDone,reconnect}) {
 const [draft,setDraft] = useState({provider:reconnect?.provider || 'forwarding',address:reconnect?.address || '',displayName:reconnect?.display_name || '',imapHost:'',smtpHost:'',imapPort:'',smtpPort:'',username:'',password:'',smtpUsername:'',smtpPassword:''});
 const [error,setError] = useState('');const id = useId();
 const oauthProvider = ['gmail','microsoft'].includes(draft.provider);
 const unavailable = oauthProvider ? oauth?.[draft.provider]?.ready === false : draft.provider === 'imap' && socketHosts?.length === 0;
 const change = (key,value) => setDraft(current=>({...current,[key]:value}));
 const field = (key,label,type='text',hint) => <Field key={key} name={`${id}-${key}`} label={label} type={type==='email'?'text':type} value={draft[key]} onChange={(_,value)=>change(key,value)} hint={hint}/>;
 const save = async () => {
  setError('');
  if(unavailable)return;
  if(!oauthProvider && (!draft.address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.address))){setError('Enter a valid mailbox email address.');return;}
  if(draft.provider==='imap' && ['imapHost','smtpHost','username','password'].some(key=>!draft[key].trim())){setError('Enter both mail hosts, username and password.');return;}
  const {imapPort,smtpPort,...connection}=draft;
  const body = oauthProvider ? {provider:draft.provider,displayName:draft.displayName} : draft.provider==='forwarding' ? {provider:'forwarding',address:draft.address,displayName:draft.displayName} : {...connection,...(imapPort!==''?{imapPort:Number(imapPort)}:{}),...(smtpPort!==''?{smtpPort:Number(smtpPort)}:{})};
  const suffix = reconnect ? `/${encodeURIComponent(reconnect.id)}/reconnect` : oauthProvider ? '/connect' : draft.provider==='imap' ? '/imap' : '';
  const result = await act(suffix,jsonBody('POST',body),oauthProvider?'Opening provider authorization…':'Mailbox saved.');
  if(!result)return;
  setDraft(current=>({...current,password:'',smtpPassword:''}));
  if(result.url) {const target = new URL(result.url,location.origin);if(target.protocol!=='https:'){setError('Authorization returned an invalid URL.');return;}location.assign(target.href);}
  else onDone();
 };
 return <fieldset className="email-editor" disabled={busy} onKeyDown={event=>{if(event.key==='Enter'&&event.target.tagName==='INPUT'){event.preventDefault();save();}}}>
  <legend>{reconnect?'Reconnect IMAP mailbox':'Connect a mailbox'}</legend>
  {error && <p className="alert alert-danger" role="alert">{error}</p>}
  {!reconnect && <Field name={`${id}-provider`} label="Connection" value={draft.provider} onChange={(_,value)=>change('provider',value)} options={[{value:'forwarding',label:'Email forwarding'},{value:'gmail',label:'Google Gmail'},{value:'microsoft',label:'Microsoft 365 / Graph'},{value:'imap',label:'IMAP and SMTP'}]}/>}
  {field('displayName','Sender / brand name')}
  {['gmail','microsoft'].includes(draft.provider) ? <p className="settings-note">Authorize this mailbox with {draft.provider==='gmail'?'Google':'Microsoft'}. {oauth?.[draft.provider]?.ready===false?'This connection is unavailable until the installation owner configures this provider.':'You will return here after authorization.'}</p> : field('address','Mailbox address','email')}
  {draft.provider==='forwarding' && <p className="settings-note">Use an address on your domain, then route it using the receiving instructions above. Replies use the installation’s verified sender.</p>}
  {draft.provider==='imap' && <><div className="settings-grid">{field('imapHost','IMAP host')}{field('smtpHost','SMTP host')}{['imapPort','smtpPort'].map(key=><Field key={key} name={`${id}-${key}`} label={key==='imapPort'?'IMAP TLS port':'SMTP TLS port'} value={draft[key]} onChange={(_,value)=>change(key,value)} options={[{value:'',label:key==='imapPort'?'Default (993)':'Default (465)'},...(socketPorts||[]).map(port=>({value:String(port),label:String(port)}))]}/>)}{field('username','IMAP username')}{field('password','IMAP password','password')}{field('smtpUsername','SMTP username (if different)')}{field('smtpPassword','SMTP password (if different)','password')}</div><p className="settings-note">Use an app password where your provider requires one. Passwords are encrypted and are never shown again.{socketHosts?.length>0 && <> Allowed socket hosts: {socketHosts.join(', ')}.</>}</p></>}
  {draft.provider==='imap' && unavailable && <p className="settings-note" role="status">IMAP and SMTP connections are unavailable until the installation owner allows the mail server hosts.</p>}
  <div className="email-actions"><button className="btn btn-primary" type="button" onClick={save} disabled={unavailable}>{busy?'Connecting…':['gmail','microsoft'].includes(draft.provider)?'Authorize mailbox':'Save mailbox'}</button><button className="btn btn-white" type="button" onClick={onDone}>Cancel</button></div>
 </fieldset>;
}
