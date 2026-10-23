import React from 'react';
export default function ChannelChanges({changes=[]}){
 return changes.map((change,i)=><article key={i} className="border rounded p-2 mt-2" aria-label="Provider message change">
  <strong>{change.kind==='attachment_review'?'Attachment change held for review':`Provider message ${change.kind}`}</strong>
  <p>{change.actor_name} · <time dateTime={new Date(change.at).toISOString()}>{new Date(change.at).toLocaleString()}</time></p>
  <p>{change.kind==='edited'?change.content:change.kind==='deleted'?'The source message was removed.':'Review the changed attachment in the provider before updating this ticket.'}</p>
  <p>The original support record is retained until customer erasure.</p>
 </article>);
}
