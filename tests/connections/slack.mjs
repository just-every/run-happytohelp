import assert from 'node:assert/strict'
import {body} from './harness.mjs'

export const installSlack=h=>h.call('/api/management/projects/p/connections/slack',body({name:'Support team',mode:'incoming-webhook',url:'https://hooks.slack.com/services/T123/B123/synthetic-support'}))
export async function assertSlack(h,destination,id){
 const receipts=h.received.filter(receipt=>receipt.path.startsWith('/hooks.slack.com/'))
 assert.equal(receipts.length,1)
 const message=JSON.parse(receipts[0].body)
 assert.equal(message.blocks[0].text.type,'plain_text');assert.equal(message.mrkdwn,false);assert.equal(message.unfurl_links,false)
 assert.ok(message.blocks[0].text.text.includes('&lt;!channel&gt;'));assert.ok(!message.blocks[0].text.text.includes('<@U123>'))
 assert.ok(!JSON.stringify(message).includes('Private warehouse context'))
 const delivered=(await h.call('/api/management/projects/p/connections/deliveries')).data.find(row=>row.destination_id===destination.id)
 assert.equal(delivered.state,'accepted')
 const before=h.received.length;await h.dispatch();assert.equal(h.received.length,before,'native request '+id+' is notified once')
}
