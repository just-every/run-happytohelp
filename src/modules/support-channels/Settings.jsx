import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../../ui/native/transport';
import '../../ui/native/pages/connections/connections.css';
const names={sms:'Twilio US SMS',whatsapp:'WhatsApp Business',instagram:'Instagram Direct',messenger:'Facebook Messenger',slack:'Slack customer channels'};
export default function ChannelSettings({projectId}){
 const root=`/api/support-channels/projects/${projectId}`;
 const [rows,setRows]=useState([]),[report,setReport]=useState([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[provider,setProvider]=useState('sms'),[verify,setVerify]=useState(null);
 const load=async()=>{const [list,counts]=await Promise.all([nativeRequest(root+'/connections'),nativeRequest(root+'/report')]);setRows(list.data);setReport(counts.data);};
 useEffect(()=>{let active=true;setRows([]);setReport([]);setVerify(null);load().catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[root]);
 const save=async e=>{e.preventDefault();const form=e.currentTarget,data=new FormData(form);setBusy(true);setError('');setNotice('');setVerify(null);try{const result=await nativeRequest(root+'/connections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,account:data.get('account'),sender:data.get('sender'),token:data.get('token'),signing_secret:data.get('signing_secret'),channels:String(data.get('channels')||'').split(',').map(x=>x.trim()).filter(Boolean),registered:data.has('registered')})});form.reset();setVerify(result.data);setNotice('Connection saved. Configure the webhook with your provider. Live account qualification is still required.');await load();}catch(e){setError(e.message);}finally{setBusy(false);}};
 const revoke=async row=>{setBusy(true);setError('');try{await nativeRequest(root+'/connections/'+row.id,{method:'DELETE'});setNotice('Connection revoked. No new channel send is authorized.');await load();}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <div className="workspace-settings connections-page" style={{maxWidth:800,overflowWrap:'anywhere'}} aria-busy={busy}>
  <p>Receive customer messages in the shared inbox and reply in their original channel.</p>
  <p className="alert alert-warning">Text support is available for qualification. Media intake and sending, approved WhatsApp continuation templates, and live provider acceptance remain pending. Teams shared-channel intake is unavailable.</p>
  {error&&<p role="alert" className="alert alert-danger">{error}</p>}{notice&&<p role="status" className="alert alert-info">{notice}</p>}
  <h2>Connect a support channel</h2>
  <p>Install an authorized provider app first. Use only the account and customer channels it can access. Slack needs chat:write, channels:history and files:read for the selected shared channels; notifications alone do not provide intake.</p>
  <form onSubmit={save} className="d-grid gap-3">
   <label>Provider<select className="form-select" value={provider} onChange={e=>setProvider(e.target.value)}>{Object.entries(names).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
   <label>Provider account ID<input className="form-control" name="account" required maxLength={200}/></label>
   <label>{provider==='sms'?'US sender number (+1)':provider==='slack'?'App bot user ID':'Page or phone number ID'}<input className="form-control" name="sender" required maxLength={200}/></label>
   <label>Provider access token<input className="form-control" name="token" type="password" autoComplete="new-password" required/></label>
   <label>{provider==='sms'?'Twilio auth token for signature verification':'App signing secret'}<input className="form-control" name="signing_secret" type="password" autoComplete="new-password" required/></label>
   {provider==='slack'&&<label>Allowed customer channel IDs (comma separated)<input className="form-control" name="channels" required placeholder="C12345678, C23456789"/></label>}
   {provider==='sms'&&<label><input name="registered" type="checkbox" required/> I have completed the provider’s A2P 10DLC registration for this US sender.</label>}
   <p>Credentials are encrypted and never read back. Reconnecting the same account preserves opt-out and erasure fences. A teammate cannot override customer opt-out. After a reply window expires, wait for the customer; approved template continuation is pending.</p>
   <button className="btn btn-primary" disabled={busy}>Save support channel</button>
  </form>
  {verify&&<section className="alert alert-info"><h2>Configure provider webhook</h2><p>Webhook: <code>{verify.webhook_url}</code></p><label>Verification token (shown once)<input className="form-control" value={verify.verify_token} readOnly/></label><button className="btn btn-outline-secondary mt-2" onClick={()=>setVerify(null)}>Dismiss verification token</button></section>}
  <h2 className="mt-4">Connected channels</h2>{rows.length===0&&<p>No support channels connected.</p>}{rows.map(row=><article key={row.id} className="border rounded p-3 mb-3"><h3>{names[row.provider]}</h3><p>{row.account} · {row.sender}</p><p>Status: {row.revoked_at?'Revoked':'Configured; live qualification pending'}</p><p>Webhook: <code>{row.webhook_url}</code></p>{row.provider==='slack'&&<p>Allowed channels: {JSON.parse(row.channels_json).join(', ')}</p>}{!row.revoked_at&&<button className="btn btn-outline-danger" disabled={busy} onClick={()=>revoke(row)}>Revoke {names[row.provider]}</button>}</article>)}
  <h2>Channel delivery report</h2><p>Accepted means the provider accepted the request. It does not prove customer delivery. Unknown outcomes are never retried automatically.</p>{report.length===0?<p>No channel sends recorded.</p>:<ul>{report.map((r,i)=><li key={i}>{names[r.provider]}: {r.state} · {r.count}{r.error_code&&` · ${r.error_code}`}</li>)}</ul>}
 </div>;
}
