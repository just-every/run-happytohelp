import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {strangerFixture} from '../repo/tests/helpers/stranger11-browser.mjs';
import {viewports} from '../repo/tests/journeys/kit/browser.mjs';
const phase=process.argv[2]||'before',root=new URL(`./screenshots/${phase}/`,import.meta.url).pathname;
await mkdir(root,{recursive:true});
const f=await strangerFixture({vars:{APP_ORIGIN:'http://127.0.0.1'}});let success=false;
const receipt={phase,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),workingTreeClean:!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),screenshots:[],checks:[],viewportMeasurements:[]};
try{
 const {page,request,projectId,origin,browser,api}=f;
 const project=await request(`/api/identity/projects/${projectId}`);
 await request(`/api/management/projects/${projectId}/widget-settings`,{settings:{collect:{require_name:true,require_email:true},message:{collect_attachments:true}}},'PUT');
 const visitorContext=await browser.newContext({viewport:viewports.desktop}),widget=await visitorContext.newPage();widget.setDefaultTimeout(20000);
 await widget.goto(origin+`/help/${projectId}`);await widget.addScriptTag({url:origin+'/widget.js'});
 await widget.evaluate(options=>window.h2h('init',options),{widgetKey:project.widget_key,apiOrigin:origin,open:true,settings:{collector:{enabled:false}}});
 await widget.locator('input[name=name]').fill('Dana');await widget.locator('input[name=email]').fill('synthetic-hh-dana@example.test');
 await widget.locator('textarea[name=content]').fill('Can you help with my order?');await widget.locator('button[name=submit]').click();
 const key=`rer-widget:${origin}:${project.widget_key}`;
 await widget.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.conversationId,key);
 const session=await widget.evaluate(key=>JSON.parse(localStorage.getItem(key)),key),id=session.conversationId;
 receipt.contact=(await request(`/api/dashboard/projects/${projectId}/conversations/${id}`)).data.contact.display_name;
 // Anonymous page opens have not written. Keep them separate from the requester.
 for(let i=0;i<3;i++)await api('/api/identity/widget/session',{widgetKey:project.widget_key},undefined,'POST',{Origin:origin});
 const snapshot=async(name,target=page)=>{
  for(const viewport of [viewports.desktop,viewports.mobile]){
   await target.setViewportSize(viewport);await target.waitForTimeout(350);
   if(name==='D15-ticket-status' && viewport.width===390){const show=target.getByRole('button',{name:'Show conversation panel',exact:true});if(await show.isVisible())await show.click();await target.getByRole('tab',{name:'Ticket',exact:true}).click();await target.locator('#ticket-summary-status').waitFor();}
   if(name==='D4-email-explanation' && !(await target.getByRole('tooltip').isVisible().catch(()=>false))){await target.getByRole('button',{name:'Email not confirmed',exact:true}).click();await target.getByRole('tooltip').waitFor();}
   receipt.viewportMeasurements.push({name,width:viewport.width,documentWidth:await target.evaluate(()=>document.documentElement.scrollWidth)});
   const path=`${root}${name}-${viewport.width}.png`;await target.screenshot({path,fullPage:true});receipt.screenshots.push(`screenshots/${phase}/${name}-${viewport.width}.png`);
  }
  await target.setViewportSize(viewports.desktop);
 };
 await page.goto(`${origin}/projects/${projectId}/conversations/${id}`);await page.getByText('Can you help with my order?',{exact:true}).first().waitFor();
 await page.getByRole('textbox',{name:'Reply to conversation'}).fill('We can help with your order.');await page.getByRole('button',{name:'Send',exact:true}).click();
 await widget.getByText('We can help with your order.',{exact:true}).waitFor();receipt.checks.push('Owner reply appeared in the customer widget');
 await page.locator('.transcript-message-content').getByText('We can help with your order.',{exact:true}).waitFor();
 await snapshot('D4-D13-D14-D16-conversation');
 if(phase==='after'){await snapshot('D4-email-explanation');await page.getByRole('button',{name:'Email not confirmed',exact:true}).click();}
 const show=page.getByRole('button',{name:'Show conversation panel',exact:true});if(await show.isVisible())await show.click();
 await page.getByRole('tab',{name:'Ticket',exact:true}).click();await page.locator('#ticket-summary-status').waitFor();
 if(phase==='after'){
  const saved=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname.endsWith(`/conversations/${id}/ticket`));
  await page.locator('#ticket-summary-status').selectOption('on_hold');assert.equal((await saved).status(),200);
  const customerView=await api(`/api/conversations/${id}`,undefined,session.token);receipt.onHoldCustomerState=customerView.status_category;assert.equal(customerView.status_category,'open');
 }
 await snapshot('D15-ticket-status');
 await page.goto(`${origin}/projects/${projectId}/macros/create`);await page.getByLabel('Title',{exact:true}).waitFor();receipt.savedReplyVisibleFields=await page.locator('main input:visible,main textarea:visible,main select:visible').count();await snapshot('D11-save-reply');
 if(phase==='after'){await page.getByText('More options',{exact:true}).click();await snapshot('D11-more-options');}
 const reply=await request(`/api/management/projects/${projectId}/macros`,{title:'Refund',content:'Your refund is being checked.',actions:{},scope:{visibility:'shared',roles:[],groups:[],brands:[]}});
 await page.goto(`${origin}/projects/${projectId}/contacts`);await page.locator('.management-table tbody tr').first().waitFor();await page.waitForTimeout(500);
 receipt.contactRows=await page.locator('.management-table tbody tr').count();await snapshot('D18-contacts');
 if(phase==='after'){const refusal=await page.request.post(origin+'/api/identity/step-up/email',{data:{purpose:'audit.export'}});receipt.confirmationEmailRefusalStatus=refusal.status();assert.equal(refusal.status(),503);}
 if(phase==='after'){
  await page.goto(`${origin}/projects/${projectId}/contacts`);await page.getByLabel("Show visitors who haven't written",{exact:true}).waitFor();
  const all=(await request(`/api/management/projects/${projectId}/contacts`)).data;
  await page.getByLabel("Show visitors who haven't written",{exact:true}).check();
  await page.waitForFunction(count=>document.querySelectorAll('.management-table tbody tr').length===count,all.length);receipt.shownVisitorRows=all.length;
  const emailOnly=(await request(`/api/management/projects/${projectId}/contacts`,{email:'synthetic-hh-email-only@example.test'})).data;
  await page.reload();await page.getByRole('link',{name:emailOnly.email,exact:true}).waitFor();await snapshot('D18-email-fallback');receipt.checks.push('An email-only contact is included and displayed by its saved email');
 }
 await page.goto(`${origin}/projects/${projectId}/security-log`);await page.getByRole('heading',{name:'Activity',exact:true}).waitFor();await page.locator('.security-events tbody tr').first().waitFor();await snapshot('D21-security-log');
 await page.goto(`${origin}/users/profile`);await page.locator('.navbar-workspace-toggle').waitFor();await snapshot('D22-profile');
 await page.goto(`${origin}/projects/${projectId}/conversations/${id}`);await page.locator('.conversation-header-close').waitFor();await page.locator('.conversation-header-close').click();
 if(phase==='after'){const customerView=await api(`/api/conversations/${id}`,undefined,session.token);receipt.solvedCustomerState=customerView.status_category;assert.equal(customerView.status_category,'solved');}
 await widget.getByText('Did this answer your question?',{exact:true}).waitFor();await snapshot('D13-widget-rating',widget);
 if(phase==='after'){
  assert.equal(await widget.getByLabel('Comment (optional)',{exact:true}).isVisible(),false);assert.equal(await widget.getByLabel('Is your issue resolved? (optional)',{exact:true}).isVisible(),false);
  await widget.getByRole('button',{name:'👍 Yes',exact:true}).click();await widget.getByRole('button',{name:'Send rating',exact:true}).click();await widget.getByText('Thanks for your feedback. You can change it here.',{exact:true}).waitFor();
  receipt.checks.push('Customer rated the conversation without answering another question');
 }
 await visitorContext.close();success=true;
}finally{await writeFile(new URL(`./${phase}-receipt.json`,import.meta.url),JSON.stringify(receipt,null,2)+'\n');await f.close(success);}
