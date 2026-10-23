import VoiceTooltips from './VoiceTooltips';
import React,{useState} from 'react';
import {nativeRequest} from '../../transport';
import {Feedback,Section} from '../forms';
import './voice.css';
export default function VoiceReport({projectId}){
 const [report,setReport]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{setBusy(true);setError('');try{setReport(await nativeRequest(`/api/voice/projects/${projectId}/report`));}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <div className="voice-report"><VoiceTooltips/><Section title="Telephone calls"><Feedback error={error}/><button type="button" className="btn btn-secondary" disabled={busy} onClick={load}>{busy?'Loading…':'Load telephone report'}</button>{report&&<><p>{report.definition}</p>{report.data.length?<table><thead><tr><th>Provider</th><th>Status</th><th>Calls</th><th>Follow-up</th></tr></thead><tbody>{report.data.map(r=><tr key={r.provider+r.state}><td>{r.provider}</td><td>{r.state.replaceAll('_',' ')}</td><td>{r.calls}</td><td>{r.follow_up}</td></tr>)}</tbody></table>:<p>No retained calls.</p>}</>}</Section></div>;
}
