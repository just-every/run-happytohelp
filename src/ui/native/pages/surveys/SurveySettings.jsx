import React,{useEffect,useRef,useState} from 'react';
import {nativeRequest} from '../../transport';
import {useUnsavedChanges} from '../../NavigationGuard';
import {Field,Section} from '../forms';
import './surveys.css';

export default function SurveySettings({projectId,role}){
 const path=`/api/outcomes/projects/${projectId}/settings`,{markDirty,markSaved}=useUnsavedChanges();
 const [settings,setSettings]=useState(null),[error,setError]=useState(''),[state,setState]=useState('');
 const latest=useRef(null),version=useRef(0),queue=useRef(Promise.resolve());
 const canManage=['owner','admin'].includes(role);
 useEffect(()=>{let active=true;nativeRequest(path).then(value=>{if(active){latest.current=value;setSettings(value)}}).catch(failure=>{if(active)setError(failure.message)});return()=>{active=false}},[path]);
 const persist=value=>{
  const revision=++version.current;latest.current=value;setSettings(value);markDirty();setState('Saving…');setError('');
  queue.current=queue.current.catch(()=>{}).then(()=>nativeRequest(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})).then(saved=>{
   if(revision===version.current){latest.current=saved;setSettings(saved);setState('Saved');markSaved()}
  }).catch(failure=>{if(revision===version.current){setError(failure.message);setState('')}});
 };
 const change=(key,value)=>persist({...latest.current,[key]:value});
 return <Section card title="Satisfaction surveys">
  <p>Scale, language and timing apply to new resolution cycles.</p>
  {error&&<p role="alert">{error} {canManage&&<button type="button" className="btn btn-white" onClick={()=>persist(latest.current)}>Retry</button>}</p>}
  {state&&<p role="status">{state}</p>}
  {settings?<fieldset disabled={!canManage} className="csat-settings">
   <Field name="enabled" label="Send email surveys after resolution" type="checkbox" value={settings.enabled} onChange={change}/>
   <Field name="widgetEnabled" label="Show surveys in the widget after resolution" type="checkbox" value={settings.widgetEnabled} onChange={change}/>
   <Field name="scale" label="Rating scale" value={settings.scale} onChange={change} options={[{value:'thumbs',label:'Thumbs up / down'},{value:'five',label:'1–5 rating'}]}/>
   <Field name="locale" label="Survey language" value={settings.locale} onChange={change} options={[{value:'en',label:'English'},{value:'es',label:'Español'},{value:'fr',label:'Français'}]}/>
   <Field name="delayMinutes" label="Send delay (minutes)" type="number" min={0} max={43200} value={settings.delayMinutes} onChange={change}/>
   <Field name="expiresDays" label="Link lifetime (days)" type="number" min={1} max={90} value={settings.expiresDays} onChange={change}/>
  </fieldset>:!error&&<p role="status">Loading survey settings…</p>}
 </Section>;
}
