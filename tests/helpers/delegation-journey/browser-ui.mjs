import assert from 'node:assert/strict';
import {join} from 'node:path';
import {report} from './case.mjs';

export function browserUI({page,context,origin,actor,api,width,evidence,captions}){
 let conversationId;
 const openPanel=async()=>{
  await page.locator('.conversation-assistant-toggle').waitFor();
  const show=page.getByRole('button',{name:'Show conversation panel',exact:true});if(await show.isVisible())await show.click();
  await page.locator('#conversation-assistant[aria-hidden=false]').waitFor();await page.getByRole('tab',{name:'Delegate',exact:true}).click();
 };
 const ui={
  async open(id,{panel=true}={}){
   conversationId=id;await page.goto(origin+`/projects/${actor.projectId}/conversations/${id}`);
   if(panel)await openPanel();else{
    const hide=page.getByRole('button',{name:'Hide conversation panel',exact:true});if(width===390&&await hide.isVisible())await hide.click();
    await page.locator('.transcript-message-content').getByText(report,{exact:true}).waitFor();
   }
  },
  async refresh(){
   // Reload unmounts the polling Delegate panel and resets the selected tab to Suggest.
   // Observe a request started by opening Local in the new document, so an old
   // poll cannot supply a response whose body navigation has already discarded.
   await page.reload();
   const [request]=await Promise.all([
    page.waitForRequest(r=>r.frame()===page.mainFrame()&&new URL(r.url()).pathname===`/api/projects/${actor.projectId}/conversations/${conversationId}/delegations`&&r.method()==='GET'),
    openPanel(),
   ]);
   const response=await request.response();assert.ok(response);
   assert.equal(response.status(),200);const jobs=(await response.json()).data;
   for(const job of jobs){
    const card=page.locator('.delegation-job').filter({has:page.locator(`[id="delegation-job-${job.id}"]`)});
    await card.waitFor();
    if(job.result?.summary)await card.getByText(job.result.summary,{exact:true}).waitFor();
    if(job.status==='completed'){
     const details=card.locator('.delegation-job__completed-details');
     await details.waitFor();if(await details.getAttribute('open')===null)await details.locator('summary').click();
     for(const action of job.result.actions)await details.getByText(action.evidence,{exact:true}).waitFor();
    }
   }
   await page.locator('.delegation-panel__loading').waitFor({state:'hidden'});
   if(jobs.length)await page.locator(`[id="delegation-job-${jobs[0].id}"]`).scrollIntoViewIfNeeded();
  },
  async pair(){
   await page.goto(origin+`/projects/${actor.projectId}/local-agent`);await page.getByRole('button',{name:'Connect computer',exact:true}).click();
   // The second viewport shares the installed workspace. Its first computer is
   // already paired, so this same dialog offers Connect another computer.
   const generate=page.locator('.delegation-setup-modal').getByRole('button',{name:/^(Generate setup command|Connect another computer)$/});
   await generate.waitFor();assert.equal(await generate.count(),1);
   const [paired]=await Promise.all([
    page.waitForResponse(r=>new URL(r.url()).pathname===`/api/projects/${actor.projectId}/local-agents/pairings`&&r.request().method()==='POST'),
    generate.click(),
   ]);
   assert.equal(paired.status(),200);const code=(await paired.json()).data.code;assert.ok(code);
   // Pairing capabilities are not photographed. The following screenshot shows
   // only the paired device and the explicit conversation instruction.
   await page.keyboard.press('Escape');await ui.open(conversationId);return code;
  },
  async delegate(device,mode,instructions){
   await ui.refresh();await page.locator('#delegation-device').selectOption(device);await page.locator('#delegation-mode').selectOption(mode);await page.locator('#delegation-instructions').fill(instructions);
   const [sent]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/delegations')&&r.request().method()==='POST'),page.getByRole('button',{name:/^(Send|Queue) task$/}).click()]);
   assert.equal(sent.status(),200);const job=(await sent.json()).data;await page.locator(`[id="delegation-job-${job.id}"]`).waitFor();return job;
  },
  async approve(path,jobId){
   const [approved]=await Promise.all([page.waitForResponse(r=>r.url().endsWith(`/delegations/${jobId}/result/follow-up-actions/enable`)),page.getByRole('button',{name:'Run Enable Spanish',exact:true}).click()]);
   assert.equal(approved.status(),200);return (await approved.json()).data;
  },
  async send(reply,jobId){
   await page.getByRole('button',{name:'Use '+reply.title,exact:true}).click();
   const composer=page.getByPlaceholder('Type your reply…');await page.waitForFunction(body=>document.querySelector('textarea[aria-label="Reply to conversation"]')?.value===body,reply.body);assert.equal(await composer.inputValue(),reply.body);
   const messagePath=`/api/conversations/${conversationId}/messages`;
   const [sent]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===messagePath&&r.request().method()==='POST'),page.getByRole('button',{name:'Send',exact:true}).click()]);
   assert.equal(sent.status(),200);const command=sent.request().postDataJSON();assert.equal(command.authoring.jobId,jobId);
   const replay=await api(messagePath,command);const value=await sent.json();assert.equal(replay.duplicate,true);assert.equal(replay.message.id,value.message.id);
   await page.locator('.transcript-message-content').getByText(reply.body,{exact:true}).waitFor();return value;
  },
  async shot(step,caption){
   for(const [side,surface] of [['operator',page],['visitor',ui.visitorPage]]){
    assert.ok(await surface.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),side+' fits viewport');
    const name=`${width}-${step}-${side}.png`;await surface.screenshot({path:join(evidence,name),fullPage:true});captions.push(`- [${name}](${name}): ${caption} (${side}, ${width}px; local test, scripted provider.)`);
   }
  },
 };
 return ui;
}
