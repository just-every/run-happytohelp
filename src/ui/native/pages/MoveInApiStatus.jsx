import React from 'react';

export default function MoveInApiStatus({api}){
 if(!api)return null;
 const failures=api.attachmentFailures||[];
 return <div className="move-in-api"><h3>{api.mode==='delta'?'Final sync':'Fetched from your help desk'}</h3><dl className="move-in-api-counts" aria-label="Fetched records">{Object.entries(api.counts||{}).map(([kind,count])=><div key={kind}><dt>{(kind.charAt(0).toUpperCase()+kind.slice(1)).replace(/([a-z])([A-Z])/g,'$1 $2')}</dt><dd>{count}</dd></div>)}</dl><p className="settings-note">These are fetched counts. The review below shows which records can be imported and which need attention. No messages or notifications are sent.</p>
  {failures.length>0&&<details open className="move-in-details"><summary>Attachments needing attention ({failures.length})</summary><p>These files were not downloaded. Review each failure before cutover; an attachment name alone does not mean its bytes were copied.</p><ul>{failures.map((failure,index)=><li key={`${failure.ticketId}/${failure.filename}/${index}`}><b>Ticket {failure.ticketId}</b> — {failure.filename}: {failure.error}</li>)}</ul></details>}
 </div>;
}
