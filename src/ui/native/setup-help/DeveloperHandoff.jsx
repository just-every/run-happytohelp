import React, {useRef, useState} from 'react';
import './developer-handoff.css';

/** Only setup instructions belong here; never include entered credentials. */
export default function DeveloperHandoff({what, unlocks, steps, subject = 'Help set up HappyToHelp', children}) {
 const details = useRef(null), [status, setStatus] = useState('');
 const message = `${what}\n${unlocks}\n\n${steps}`;
 const copy = async () => {
  try { await navigator.clipboard.writeText(message); setStatus('Steps copied'); }
  catch { details.current.open = true; setStatus('Select the steps below and copy them.'); }
 };
 return <aside className="developer-handoff" aria-label="Developer hand-off">
  <h3>Needs a technical person</h3><p>{what}</p><p>{unlocks}</p>
  <div className="developer-handoff__actions">
   <a className="btn btn-white btn-sm" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}>Send these steps to my developer</a>
   <button type="button" className="btn btn-white btn-sm" onClick={copy}>Copy steps</button>
  </div>
  <span role="status">{status}</span>
  <details ref={details}><summary>Details for your developer</summary>{children || <pre tabIndex={0}>{steps}</pre>}</details>
 </aside>;
}
