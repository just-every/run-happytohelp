import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../../../native/transport';
import {useUnsavedChanges} from '../../../native/NavigationGuard';
const defaults=()=>({id:crypto.randomUUID(),revision:0,name:'Checkout help',enabled:false,sender:'Support team',brand:'Support',message:'Need a hand with checkout?',pathPrefix:'/checkout',trigger:{type:'time',seconds:20},audience:'all',delaySeconds:20,dailyCap:1,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,quietHours:{enabled:true,start:20,end:8}});
const triggers={page:{},time:{seconds:20},scroll:{percent:50},exit:{},attribute:{key:'plan',value:'plus'},returning:{},cart:{minimum:100}};
export default function CampaignSettings({projectId}){
 const [campaigns,setCampaigns]=useState([]),[draft,setDraft]=useState(null),[error,setError]=useState(''),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false);
 const {markDirty,markSaved}=useUnsavedChanges(),endpoint=`/api/management/projects/${projectId}/widget-campaigns`;
 const load=()=>nativeRequest(endpoint).then(result=>setCampaigns(result.campaigns));
 useEffect(()=>{setDraft(null);load().catch(e=>setError(e.message));},[endpoint]);
 const change=(key,value)=>{setDraft(current=>({...current,[key]:value}));setSaved(false);markDirty();};
 const save=async()=>{setBusy(true);setError('');setSaved(false);try{const {id,...body}=draft;const result=await nativeRequest(`${endpoint}/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});setDraft(result);await load();markSaved();setSaved(true);}catch(e){setError(e.message);}finally{setBusy(false);}};
 const field=(key,label,{type='text',min,max}={})=><label className="form-label d-block">{label}<input className="form-control" type={type} min={min} max={max} value={draft[key]} onChange={e=>change(key,type==='number'?Number(e.target.value):e.target.value)}/></label>;
 return <section className="settings-section campaign-settings" aria-label="Proactive campaigns">
  <h2>Proactive campaigns</h2><p>Offer a small, dismissible card after a visitor agrees to page activity sharing. Enable both contact tracking and proactive help in Project settings. Campaigns need no AI key.</p>
  <p>Opening a card only opens the composer. The visitor chooses what to send. Query strings, page contents and form values are never used by campaigns.</p>
  <div className="d-flex flex-wrap gap-2 mb-3">{campaigns.map(c=><button className="btn btn-outline-dark" type="button" key={c.id} onClick={()=>{setDraft(c);setSaved(false);setError('');}}>{c.name} · {c.enabled?'On':'Off'}</button>)}<button className="btn btn-outline-dark" type="button" onClick={()=>{setDraft(defaults());setSaved(false);}}>New campaign</button></div>
  {error&&<p role="alert">{error}</p>}{saved&&<p role="status">Campaign saved.</p>}
  {draft&&<fieldset disabled={busy}><legend>{draft.revision?'Edit campaign':'New campaign'}</legend>
   {field('name','Campaign name')}<label className="form-check mb-3"><input className="form-check-input" type="checkbox" checked={draft.enabled} onChange={e=>change('enabled',e.target.checked)}/>Campaign enabled</label>
   {field('sender','Sender name')}{field('brand','Brand name')}
   <label className="form-label d-block">Message<textarea className="form-control" rows={3} maxLength={1000} value={draft.message} onChange={e=>change('message',e.target.value)}/></label>
   {field('pathPrefix','Page URL path starts with')}<p className="form-text">For example /checkout. Applies to the widget’s allowed website only.</p>
   <label className="form-label d-block">Trigger<select className="form-select" value={draft.trigger.type} onChange={e=>change('trigger',{type:e.target.value,...triggers[e.target.value]})}><option value="page">Page URL</option><option value="time">Time on page</option><option value="scroll">Scroll depth</option><option value="exit">Exit intent</option><option value="attribute">Visitor attribute</option><option value="returning">Returning visit</option><option value="cart">Cart value</option></select></label>
   {Object.keys(triggers[draft.trigger.type]).map(key=><label className="form-label d-block" key={key}>{{seconds:'Time on page (seconds)',percent:'Scroll depth (%)',key:'Attribute key',value:'Attribute equals',minimum:'Minimum cart value'}[key]}<input className="form-control" type={['seconds','percent','minimum'].includes(key)?'number':'text'} value={draft.trigger[key]} onChange={e=>change('trigger',{...draft.trigger,[key]:['seconds','percent','minimum'].includes(key)?Number(e.target.value):e.target.value})}/></label>)}
   <p className="form-text">Attributes match saved contact metadata. Cart value is supplied explicitly by your website with h2h('settings', {'{'}campaignContext: {'{'}cartValue: 100{'}'}{'}'}). No cart or form scraping occurs. Exit intent uses a pointer leaving the top of the page.</p>
   <label className="form-label d-block">Audience<select className="form-select" value={draft.audience} onChange={e=>change('audience',e.target.value)}><option value="all">All consenting visitors</option><option value="new">New visitors</option><option value="returning">Returning visitors</option></select></label>
   <p className="form-text">A return means an earlier consented browser visit with the same widget identity. Clearing browser storage starts a new identity.</p>
   {field('delaySeconds','Minimum time on page (seconds)',{type:'number',min:0,max:86400})}{field('dailyCap','Maximum cards per visitor per day',{type:'number',min:1,max:10})}{field('timezone','Campaign timezone')}
   <label className="form-check mb-3"><input className="form-check-input" type="checkbox" checked={draft.quietHours.enabled} onChange={e=>change('quietHours',{...draft.quietHours,enabled:e.target.checked})}/>Quiet hours enabled</label>
   {['start','end'].map(key=><label className="form-label d-block" key={key}>Quiet hours {key} (0–23)<input className="form-control" type="number" min={0} max={23} value={draft.quietHours[key]} onChange={e=>change('quietHours',{...draft.quietHours,[key]:Number(e.target.value)})}/></label>)}
   <p className="form-text">Start is inclusive; end is exclusive. Overnight ranges are supported. Equal hours silence the full day. Daily caps use this timezone and include reserved cards across tabs.</p>
   <button className="btn btn-primary" type="button" onClick={save}>Save campaign</button>
  </fieldset>}
 </section>;
}
