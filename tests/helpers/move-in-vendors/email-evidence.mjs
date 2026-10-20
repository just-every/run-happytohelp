// These objects configure responses from real vendor email-evidence endpoints.
// They are never placed into undocumented fields on ticket/comment responses.
export function emailEvidence(corpus,vendor,ticketId=1,commentId) {
    const ticket=corpus.tickets.find(p=>String(p.id)===String(ticketId));
    if(!ticket)throw new Error(`Unknown email ticket ${ticketId}`);
    const part=commentId==null?ticket.comments.find(p=>!p.private&&(vendor==='helpscout'?p.authorId>=1000:p.authorId<1000))??ticket.comments[0]
        :ticket.comments.find(p=>String(p.id)===String(commentId));
    if(!part||part.private)throw new Error(`Public email comment required: ${ticketId}/${commentId}`);
    if(vendor==='freshdesk')return {ticketId:ticket.id,commentId:part.id,subject:`${ticket.subject} [#${ticket.id}]`};
    if(!part.email) {
        const incoming=part.authorId>=1000;
        const customer=corpus.contacts.find(p=>p.id===ticket.contactId);
        part.email={ticketId:ticket.id,commentId:part.id,notificationId:2_000_000+part.id,
            messageId:`<${vendor}-${part.id}@fixture.example.test>`,subject:ticket.subject,
            from:incoming?customer.email:'support@fixture.example.test',
            to:incoming?['support@fixture.example.test']:[customer.email],cc:[...ticket.cc],
            references:[`<old-notification-${ticket.id}@fixture.example.test>`,`<prior-notification-${ticket.id}@fixture.example.test>`],
            bodyDecoyMessageId:`<body-only-${part.id}@fixture.example.test>`};
    }
    return part.email;
}

export function initializeEmailEvidence(corpus,vendor) {
    if(vendor==='freshdesk')return;
    for(const ticket of corpus.tickets)for(const part of ticket.comments)if(!part.private)emailEvidence(corpus,vendor,ticket.id,part.id);
}

export function configureEmailEvidence(corpus,vendor,{ticketId=1,commentId,...changes}={}) {
    if(vendor==='freshdesk')throw new Error('Freshdesk API does not expose Message-ID evidence');
    return Object.assign(emailEvidence(corpus,vendor,ticketId,commentId),changes);
}

export function intercomEmailMetadata(evidence,{source=false}={}) {
    const address=(type,email_address)=>({type,email_address,name:null,drop_reason:null});
    return {message_id:evidence.messageId,subject:evidence.subject,email_address_headers:[
        address('from',evidence.from),...evidence.to.map(value=>address('to',value)),
        ...evidence.cc.map(value=>address('cc',value)),
    ],...(source?{history:''}:{})};
}

export function originalEmail(evidence,part) {
    const headers=[`Message-ID: ${evidence.messageId}`,`Date: ${new Date(part.createdAt).toUTCString()}`,
        `From: ${evidence.from}`,`To: ${evidence.to.join(', ')}`,`Subject: ${evidence.subject}`,
        ...(evidence.cc.length?[`Cc: ${evidence.cc.join(', ')}`]:[])];
    // A folded References field and a header-looking body line deliberately differ.
    // Only the RFC header block may become threading evidence.
    if(evidence.references.length)headers.push(`References: ${evidence.references[0]}`,
        ...evidence.references.slice(1).map(value=>`\t${value}`));
    headers.push('MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8');
    return headers.join('\r\n')+'\r\n\r\n'+part.body+'\r\n\r\nMessage-ID: '+evidence.bodyDecoyMessageId+'\r\n';
}
