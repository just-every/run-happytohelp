import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {auditPage,viewports} from '../../journeys/kit/browser.mjs'

// Functional Settings controls for personal Slack (NOTIFY-001), asserted at 1440 with
// the affected screens also captured at 390. Real routes and state; only Slack's edge is faked.
export async function slackSettingsBrowser({page,runtime,origin,tenant,shot}){
 const api=`${origin}/api/management/projects/${tenant.projectId}`,P=`${origin}/projects/${tenant.projectId}`
 const request=page.context().request
 const slackCode=async()=>{
  const deadline=Date.now()+10000
  while(Date.now()<deadline){
   const lines=(await readFile(join(runtime.directory,'slack.jsonl'),'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(JSON.parse)
   const code=lines.reverse().map(call=>call.blocks?.[0]?.text?.text.match(/code is (\d{8})/)?.[1]).find(Boolean)
   if(code)return code
   await new Promise(done=>setTimeout(done,100))
  }
  throw new Error('Slack never received a verification code')
 }
 const both=async name=>{await auditPage(page,shot(`${name}-1440.png`));await page.setViewportSize(viewports.mobile);await auditPage(page,shot(`${name}-390.png`));await page.setViewportSize(viewports.desktop)}
 // The existing Slack connection (Connections owns its creation).
 const connection=await request.post(api+'/connections/slack',{data:{name:'Support Slack',mode:'bot',token:'xoxb-synthetic-browser-1',channel:'C0BROWSER1'}})
 assert.equal(connection.status(),201,await connection.text())
 // Off by default and visibly unavailable to the teammate.
 await page.goto(`${origin}/users/profile`)
 await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Notification',exact:true}).click()
 await page.getByTestId('slack-unavailable').waitFor()
 assert.match(await page.getByTestId('slack-unavailable').innerText(),/not enabled/)
 await both('slack-unavailable')
 // The owner consents on the existing connection from Settings.
 await page.goto(`${P}/settings`)
 await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Notifications',exact:true}).click()
 await page.getByLabel('Slack connection',{exact:true}).selectOption({label:'Support Slack'})
 await page.getByRole('button',{name:'Enable personal Slack notices',exact:true}).click()
 await page.getByTestId('slack-consent').filter({hasText:'Enabled on Support Slack'}).waitFor()
 await both('slack-consent')
 // The teammate links their own Slack member: the code arrives in Slack and is typed back.
 await page.goto(`${origin}/users/profile`)
 await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Notification',exact:true}).click()
 await page.getByLabel('Your Slack member ID',{exact:true}).fill('U0OUTSIDER')
 await page.getByRole('button',{name:'Send me a code',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'not part of this Slack workspace'}).waitFor()
 await page.getByLabel('Your Slack member ID',{exact:true}).fill('U0OWNER001')
 await page.getByRole('button',{name:'Send me a code',exact:true}).click()
 await page.getByLabel('Code from Slack',{exact:true}).fill('00000000')
 await page.getByRole('button',{name:'Verify',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'not correct'}).waitFor()
 await page.getByLabel('Code from Slack',{exact:true}).fill(await slackCode())
 await page.getByRole('button',{name:'Verify',exact:true}).click()
 await page.getByTestId('slack-linked').filter({hasText:'U0OWNER001'}).waitFor()
 // A kind saves as you go and survives a reload.
 await page.getByLabel('A teammate mentioned you in a ticket.',{exact:true}).click()
 await page.getByRole('status').filter({hasText:'Saved'}).waitFor()
 await page.reload()
 await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Notification',exact:true}).click()
 assert.equal(await page.getByLabel('A teammate mentioned you in a ticket.',{exact:true}).isChecked(),true)
 assert.equal(await page.getByLabel('A teammate assigned a support ticket to you.',{exact:true}).isChecked(),false)
 await both('slack-linked')
 const own=await (await request.get(`${api}/teammate-slack/outcomes`)).json()
 assert.deepEqual(own.data,[],'no notice has been sent to this teammate yet')
 await page.getByRole('button',{name:'Unlink',exact:true}).click()
 await page.getByLabel('Your Slack member ID',{exact:true}).waitFor()
}
