import React from 'react';
/** Staff pages only. Never include this component in the public widget. */
export default function LocalMailNotice({mode}) {
 return mode === 'local' ? <div className="alert alert-info m-2" role="status">Email is off on this computer, so no emails are sent or received. Chat works.</div> : null;
}
