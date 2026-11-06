import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {auditPage,viewports} from '../../journeys/kit/browser.mjs'
import {teamsEdge} from './teams-edge.mjs'
export async function teamsSettingsBrowser({page,runtime,origin,tenant,shot}){
 const edge=teamsEdge(),request=page.context().request,base=`${origin}/api/management/projects/${tenant.projectId}`,P=`${origin}/projects/${tenant.projectId}`
 await writeFile(join(runtime.directory,'teams-jwk.json'),JSON.stringify(edge.jwk))
 const both=async name=>{await auditPage(page,shot(`${name}-1440.png`));await page.setViewportSize(viewports.mobile);await auditPage(page,shot(`${name}-390.png`));await page.setViewportSize(viewports.desktop)}
 const profile=async()=>{await page.goto(origin+'/users/profile');await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Notification',exact:true}).click()}
 const connection=await request.post(`${origin}/api/support-channels/projects/${tenant.projectId}/connections`,{data:{provider:'teams',account:edge.tenant,sender:edge.appId,token:'synthetic-hh-browser-secret',channels:['19:synthetic-hh-browser-channel']}})
 assert.equal(connection.status(),201,await connection.text());const id=(await connection.json()).data.id
 await profile();await page.getByTestId('teams-unavailable').waitFor();assert.match(await page.getByTestId('teams-unavailable').innerText(),/not enabled/);await both('teams-unavailable')
 await page.goto(P+'/settings');await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Notifications',exact:true}).click()
 await page.getByLabel('Teams connection',{exact:true}).selectOption(id)
 await page.getByRole('button',{name:'Enable personal Teams notices',exact:true}).click();await page.getByTestId('teams-consent').waitFor();await both('teams-consent')
 await profile();const panel=page.getByTestId('teams-personal')
 await panel.getByRole('button',{name:'Create Teams link code',exact:true}).click()
 const command=await panel.getByTestId('teams-link-command').innerText(),code=command.match(/notify link ([a-f0-9-]{36})/)[1]
 const body=edge.event({code,sender:'synthetic-hh-browser-member'})
 const linked=await request.post(`${origin}/api/support-channels/webhooks/${id}`,{headers:edge.signed(body),data:JSON.stringify(body)})
 assert.equal(linked.status(),200,await linked.text())
 await panel.getByRole('button',{name:'Refresh Teams link',exact:true}).click();await panel.getByTestId('teams-linked').waitFor()
 await panel.getByLabel('A teammate mentioned you in a ticket.',{exact:true}).check();await panel.getByRole('status').filter({hasText:'Saved'}).waitFor()
 await page.reload();await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Notification',exact:true}).click()
 assert.equal(await panel.getByLabel('A teammate mentioned you in a ticket.',{exact:true}).isChecked(),true)
 assert.equal(await panel.getByLabel('A teammate assigned a support ticket to you.',{exact:true}).isChecked(),false)
 await both('teams-linked')
 assert.deepEqual((await (await request.get(base+'/teammate-teams/outcomes')).json()).data,[])
 await panel.getByRole('button',{name:'Unlink Teams',exact:true}).click();await panel.getByRole('button',{name:'Create Teams link code',exact:true}).waitFor()
 console.log('PROBE NOTIFY-001 teams Settings: consent, authenticated personal link, preference persistence, unlink at 1440; captures teams-{unavailable,consent,linked}-{1440,390}.png')
}
