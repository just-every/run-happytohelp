import React,{useState} from 'react';
import {kindLabel,reasonLabel,recordName,vendorNames,where} from './move-in-presentation';
const PAGE=25;
const key=d=>`${d.kind}/${d.sourceId??`${where(d.location)}${d.location?.pointer??''}`}`;
// What stays behind for records that do import, grouped by its plain reason, with the records it touches.
function keptBehind(decisions){
 const groups=new Map();
 for(const d of decisions)if(!d.rejection)for(const o of d.omissions){const text=reasonLabel(o.reason),group=groups.get(text)||{text,records:[]};if(!group.records.includes(d))group.records.push(d);groups.set(text,group)}
 return [...groups.values()];
}
const names=(vendor,records)=>`${records.slice(0,3).map(d=>recordName(vendor,d)).join(', ')}${records.length>3?` and ${records.length-3} more`:''}`;

/** The plan for one upload: what imports, what needs fixing first, and what stays in the original file. */
export default function MoveInReview({plan,vendor,state}){
 const [page,setPage]=useState(0),decisions=plan.decisions||[],rejected=decisions.filter(d=>d.rejection),importing=decisions.filter(d=>d.targets.length).length,targets=decisions.flatMap(d=>d.targets),kept=keptBehind(decisions),fileNotes=(plan.diagnostics||[]).filter(d=>d.sourceId==null&&d.kind==null);
 // A conflicting duplicate is reported where it repeats; show those lines beside the rejected record.
 const repeats=new Map();for(const d of plan.diagnostics||[])if(d.code==='conflicting_duplicate_id'&&d.sourceId!=null){const k=`${d.kind}/${d.sourceId}`;repeats.set(k,[...(repeats.get(k)||[]),d.location])}
 const published=targets.filter(t=>t.kind==='article'&&t.status==='published').length,drafts=targets.filter(t=>t.kind==='article'&&t.status==='draft').length,ready=state==='ready';
 return <>
  <h3>{ready?'Review before importing':'Import summary'}</h3>
  <ul>{Object.entries(plan.counts.byKind||{}).map(([kind,count])=><li key={kind}>{kindLabel(kind)}: {count}</li>)}</ul>
  <p>{importing} of {decisions.length} records {ready?'will be':state==='completed'?'were':'are'} imported. {rejected.length?`${rejected.length} ${rejected.length===1?'needs':'need'} fixing first.`:'None need fixing.'}{plan.duplicateRecords>0&&` ${plan.duplicateRecords} repeated ${plan.duplicateRecords===1?'record was':'records were'} counted once.`}{published+drafts>0&&` Articles: ${published} will be published, ${drafts} will stay ${drafts===1?'a draft':'drafts'}.`}</p>
  <p className="settings-note">Customers are not contacted. People who were staff in {vendorNames[vendor]||'the source'} stay as the authors of their messages and get no access here.{vendor==='intercom'&&' Intercom exports have no time for a conversation’s first message, so it shows the conversation’s start time.'} Your original files are kept privately, including any fields that aren’t imported.</p>
  {rejected.length>0&&<details open className="move-in-details"><summary>Needs fixing ({rejected.length})</summary>
   <p>These records are not imported. Fix them in your file and upload it again. Uploading again is safe: records already imported are recognised and left as they are, so only the fixed records are added.</p>
   <ul>{rejected.slice(page*PAGE,page*PAGE+PAGE).map(d=><li key={key(d)}><b>{recordName(vendor,d)}</b> <small>({where(d.location)})</small>: {reasonLabel(d.rejection)}{repeats.has(`${d.kind}/${d.sourceId}`)&&` Repeated at ${repeats.get(`${d.kind}/${d.sourceId}`).map(where).join('; ')}.`}{d.omissions.length>0&&<ul>{d.omissions.map(o=><li key={o.reason}>{reasonLabel(o.reason)}</li>)}</ul>}</li>)}</ul>
   {rejected.length>PAGE&&<div className="move-in-actions"><button className="btn btn-white" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous records</button><span>Page {page+1}</span><button className="btn btn-white" disabled={(page+1)*PAGE>=rejected.length} onClick={()=>setPage(p=>p+1)}>Next records</button></div>}
  </details>}
  {kept.length>0&&<details className="move-in-details"><summary>Imported with notes ({kept.length})</summary><ul>{kept.map(group=><li key={group.text}>{group.text} <small>{group.records.length===1?'1 record':`${group.records.length} records`}: {names(vendor,group.records)}</small></li>)}</ul></details>}
  {fileNotes.length>0&&<details open className="move-in-details"><summary>About the file ({fileNotes.length})</summary><ul>{fileNotes.slice(0,PAGE).map((d,i)=><li key={i}>{where(d.location)}: {reasonLabel(d.message)}</li>)}</ul></details>}
 </>;
}
