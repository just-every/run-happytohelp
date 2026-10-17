import React, {useId} from 'react';

/** Controlled fields for the parent's durable send command. Pass operator-readable mailbox identities. */
export default function EmailSender({mailboxes=[],mailboxId='',fromAddress='',onChange,disabled=false,defaultLabel='Choose a mailbox'}) {
 const id=useId(),connected=mailboxes.filter(mailbox=>mailbox.status==='connected');
 const selected=connected.find(mailbox=>mailbox.id===mailboxId),addresses=(selected?.addresses||[]).filter(address=>address.can_send);
 return <div className="settings-grid email-sender-fields">
  <div className="form-group"><label className="form-label" htmlFor={`${id}-mailbox`}>Send from mailbox</label><select id={`${id}-mailbox`} className="form-select" disabled={disabled} value={mailboxId} onChange={event=>onChange({mailboxId:event.target.value,fromAddress:''})}><option value="">{defaultLabel}</option>{connected.map(mailbox=><option key={mailbox.id} value={mailbox.id}>{mailbox.display_name||mailbox.address} — {mailbox.address}</option>)}</select>{!connected.length&&<p className="form-text">No connected mailboxes are available. Ask a workspace administrator to connect one.</p>}</div>
  {selected&&<div className="form-group"><label className="form-label" htmlFor={`${id}-from`}>Sender address</label><select id={`${id}-from`} className="form-select" disabled={disabled} value={fromAddress} onChange={event=>onChange({mailboxId,fromAddress:event.target.value})}><option value="">Mailbox default{selected.sender_address?` (${selected.sender_address})`:''}</option>{addresses.map(address=><option key={address.address} value={address.address}>{address.address}</option>)}</select><p className="form-text">Only verified send-as aliases are listed. Your agent signature is applied by this mailbox.</p></div>}
 </div>;
}
