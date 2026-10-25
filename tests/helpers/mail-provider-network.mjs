import assert from 'node:assert/strict';

// The real Worker still validates, records and sends each mail request.
export default async request => {
    assert.equal(request.url, 'https://api.resend.com/emails', 'unexpected outbound request');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('Authorization'), 'Bearer synthetic-fixture-mail-provider');
    const message = await request.json();
    const senders=['support@example.test',...[1440,390].flatMap(width=>[`synthetic-happytohelp-ticket-${width}@support.example`,`synthetic-happytohelp-notice-${width}@support.example`])];
    assert.ok(senders.includes(message.from), 'configured fixture mailbox sender');
    assert.ok(message.to.length > 0);
    assert.ok(message.subject);
    assert.ok(message.text || message.html);
    console.log('MAIL_FIXTURE_RECEIPT '+JSON.stringify({from:message.from,to:message.to,text:message.text}));
    return Response.json({id: crypto.randomUUID()});
};
