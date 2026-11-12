import React,{useState} from 'react';
import {resultNote} from './result-note.js';
export default function PackageResult({result}){
 const [copied,setCopied]=useState(false);
 if(!result)return null;
 const {run,tables={},attachments,work}=result;
 const note=resultNote(result);
 return <div className="legacy-result"><h3>Import result</h3><p role="status">{run.state} · {result.verification}{run.errorCode?` · ${run.errorCode}`:''}</p><div className="legacy-table-scroll"><table className="table"><caption>Source history reconciliation</caption><thead><tr><th scope="col">Table</th><th scope="col">Package</th><th scope="col">Omitted</th><th scope="col">Required</th><th scope="col">Imported</th><th scope="col">Equal</th></tr></thead><tbody>{Object.entries(tables).map(([name,t])=><tr key={name}><th scope="row">{name}</th><td>{t.packageRows}</td><td>{t.excludedRows}</td><td>{t.requiredRows}</td><td>{t.journalRows}</td><td>{t.journalEqualsPackage===true?'Yes':t.journalEqualsPackage===false?'No':'Pending'}</td></tr>)}</tbody></table></div>{attachments&&<p>Attachments: {attachments.identical} of {attachments.required} identical by stored SHA-256; {attachments.withheld} withheld, {attachments.missing} missing, {attachments.different} different, {attachments.unverified} unverified.</p>}<p>Work unchanged: {work?.unchanged===true?'Yes':work?.unchanged===false?'No':'Pending'}</p><button className="btn btn-white" onClick={async()=>{try{await navigator.clipboard.writeText(note);setCopied(true)}catch{setCopied(false)}}}>Copy result note</button>{copied&&<span role="status"> Result note copied</span>}<details className="move-in-details"><summary>Counts and verification details</summary><pre>{note}</pre></details></div>;
}
