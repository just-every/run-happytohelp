import assert from 'node:assert/strict'

// The lead configures this same mailbox's sender, with provider DNS observations kept explicit.
export async function configureSender({app,mail},owner){
 const base='/api/management/projects/p',check=()=>app.ok(base+'/email-settings/check-domain?selector=key',{token:owner})
 const missing=await check();assert.ok(missing.missing.includes('SPF'));assert.ok(missing.missing.includes('DKIM'));assert.ok(missing.missing.includes('DMARC'))
 mail.dnsRecords={'example.com':['v=spf1 include:_spf.example.com -all'],'key._domainkey.example.com':['v=DKIM1; k=rsa; p=synthetic'],'_dmarc.example.com':['v=DMARC1; p=reject']}
 assert.equal((await check()).ok,true)
 mail.dnsOffline=true;assert.ok((await check()).records.every(r=>r.status==='unknown'));mail.dnsOffline=false
 assert.equal((await app.call(base+'/email-settings/check-domain')).status,401)
 const mailbox=(await app.ok(base+'/mailboxes',{token:owner,body:{provider:'forwarding',address:'helpdesk@example.com',displayName:'Order Support',aliases:['returns@example.com']}})).data
 const reconnected=(await app.ok(base+`/mailboxes/${mailbox.id}/reconnect`,{token:owner,body:{}})).data
 assert.equal(reconnected.status,'connected');assert.ok(reconnected.addresses.some(a=>a.address==='returns@example.com'))
}
