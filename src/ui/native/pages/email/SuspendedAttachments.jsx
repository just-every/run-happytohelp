import React, {useEffect, useRef, useState} from 'react';
import {nativeRequest} from '../../transport';

/** JSON metadata and escaped text only. Held files never become document/image URLs. */
export default function SuspendedAttachments({path,attachments=[],disabled=false}) {
 const [preview,setPreview]=useState(null),[loading,setLoading]=useState(null),[error,setError]=useState('');
 const request=useRef(null);
 useEffect(()=>()=>request.current?.abort(),[path]);
 const inspect=async file=>{
  request.current?.abort();const controller=new AbortController();request.current=controller;
  setLoading(file.index);setPreview(null);setError('');
  try{const result=await nativeRequest(`${path}/attachments/${encodeURIComponent(file.index)}`,{signal:controller.signal});if(!controller.signal.aborted)setPreview(result);}
  catch(failure){if(!controller.signal.aborted)setError(failure.message);}
  finally{if(!controller.signal.aborted)setLoading(null);}
 };
 if(!attachments.length)return null;
 return <section aria-label="Suspended email attachments">
  <h3 className="h6 mt-4">Attachments ({attachments.length})</h3>
  <ul className="email-addresses">{attachments.map(file=><li key={file.index}><span><strong>{file.filename||'Unnamed attachment'}</strong><br/><span className="settings-note">{file.contentType||'Unknown type'} · {Number(file.size).toLocaleString()} bytes</span></span><button type="button" className="btn btn-white" disabled={disabled||loading===file.index} onClick={()=>inspect(file)} aria-label={`Inspect ${file.filename||'attachment'}`}>{loading===file.index?'Inspecting…':'Inspect'}</button></li>)}</ul>
  {error&&<p className="alert alert-danger" role="alert">{error}</p>}
  {preview&&<div aria-live="polite"><h4 className="h6">{preview.filename}</h4><p className="settings-note">{preview.contentType} · {Number(preview.size).toLocaleString()} bytes</p>{typeof preview.text==='string'?<pre className="email-safe-preview">{preview.text||'(Empty text attachment)'}</pre>:<p className="settings-note">Text preview is unavailable for this attachment. Only plain-text and JSON files up to 64 KiB can be previewed.</p>}</div>}
 </section>;
}
