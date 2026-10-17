import React, {useId} from 'react';

export function parseEmailRecipients(value) {
 return (Array.isArray(value) ? value : String(value || '').split(/[,;\n]/)).map(item => String(item).trim()).filter(Boolean);
}
export function emailRecipientsError(value) {
 const addresses = parseEmailRecipients(value);
 if (addresses.length > 50) return 'Enter at most 50 recipients in each field.';
 if (addresses.some(address => address.length > 320 || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(address))) return 'Enter email addresses separated by commas.';
 if (new Set(addresses.map(address => address.toLowerCase())).size !== addresses.length) return 'Remove duplicate email addresses.';
 return '';
}

/** Controlled recipient fields. The caller submits cc/bcc with the same durable message command. */
export default function EmailRecipients({cc = '', bcc = '', onChange, disabled = false}) {
 const id = useId();
 return <div className="email-recipient-fields settings-grid">
  {['cc', 'bcc'].map(kind => {
   const value = kind === 'cc' ? cc : bcc, error = emailRecipientsError(value);
   return <div className="form-group" key={kind}>
    <label className="form-label" htmlFor={`${id}-${kind}`}>{kind.toUpperCase()}</label>
    <input id={`${id}-${kind}`} className={`form-control${error ? ' is-invalid' : ''}`} type="text" inputMode="email" autoComplete="off" value={Array.isArray(value) ? value.join(', ') : value} disabled={disabled} onChange={event => onChange(kind, event.target.value)} aria-invalid={!!error} aria-describedby={`${id}-${kind}-hint${error ? ` ${id}-${kind}-error` : ''}`}/>
    <div className="form-text" id={`${id}-${kind}-hint`}>{kind === 'bcc' ? 'Hidden from the requester and other recipients.' : 'Visible to everyone receiving this email.'} Separate addresses with commas.</div>
    {error && <div id={`${id}-${kind}-error`} className="invalid-feedback d-block" role="alert">{error}</div>}
   </div>;
  })}
 </div>;
}
