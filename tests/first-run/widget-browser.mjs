import assert from 'node:assert/strict';
import {audit} from './browser-kit.mjs';
import {assertLauncherAvatarFits} from '../helpers/widget-launcher-geometry.mjs';

export async function widgetJourney({browser,runtime,projectId,token,width,evidence,mailMode}){
 const project=await (await fetch(runtime.origin+'/api/identity/projects/'+projectId,{headers:{Authorization:'Bearer '+token}})).json();
 // The customer writes while nobody has the dashboard open and this team answers anyway, so presence-based away is off.
 await runtime.presenceAwayOff(projectId);
 const context=await browser.newContext({viewport:{width,height:844},bypassCSP:true}),page=await context.newPage();
 try{
  await page.goto(runtime.origin+'/help/'+projectId);await page.addScriptTag({url:runtime.origin+'/widget.js'});
  await page.evaluate(options=>window.h2h('init',options),{widgetKey:project.widget_key,apiOrigin:runtime.origin,open:false,settings:{collector:{enabled:false}}});
  const launcher=page.getByRole('button',{name:'Open chat',exact:true});await launcher.waitFor();
  await page.locator('.happytohelp-button .happytohelp-agent-avatar, .happytohelp-button .happytohelp-workspace-brand').waitFor();
  await page.waitForTimeout(400);await assertLauncherAvatarFits(launcher);
  await launcher.click();await page.locator('textarea[name=content]').waitFor();await page.waitForTimeout(400);
  const geometry=await page.locator('.happytohelp-button').evaluate(button=>{
   const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
   return {icon:rect(button.querySelector('.happytohelp-show-opened')),avatars:[...button.querySelectorAll('.happytohelp-agent-avatar,.happytohelp-workspace-brand,img')].map(rect)};
  });
  assert.deepEqual(geometry.avatars,[],'open X has no avatar to overlap');
  const visibleX=page.locator('button[aria-label="Close chat"]:visible svg').first();await visibleX.waitFor();
  const icon=await visibleX.boundingBox();assert.ok(icon.width>0&&icon.height>0,'the visible close X has a positive rectangle');
  const overlap=await page.locator('#happytohelp-root').evaluate(root=>{
   const visible=selector=>[...root.querySelectorAll(selector)].map(node=>node.getBoundingClientRect()).filter(rect=>rect.width>0&&rect.height>0);
   const icons=visible('button[aria-label="Close chat"] svg'),avatars=visible('.happytohelp-agent-avatar,.happytohelp-workspace-brand');
   return icons.some(icon=>avatars.some(avatar=>icon.left<avatar.right&&icon.right>avatar.left&&icon.top<avatar.bottom&&icon.bottom>avatar.top));
  });assert.equal(overlap,false,'every visible close X avoids every visible avatar');
  const name=await page.locator('.happytohelp-insight-agent-name').first().innerText();assert.equal(name,mailMode==='local'?`Local ${width}`:'Provider owner','the visitor sees the operator display name: derived from the sign-up email local-<width>@example.test for a one-screen setup, as given for an explicit ownerName');
  const message='A test message from this website '+width;
  await page.locator('textarea[name=content]').fill(message);await page.locator('button[name=submit]').click();await page.getByText(message,{exact:true}).waitFor();await page.waitForTimeout(500);
  if(mailMode!=='remote')assert.equal(await page.locator('.happytohelp-collect-notify-email').count(),0);
  else{await page.locator('.happytohelp-collect-notify-email').waitFor();const copy=await page.locator('.happytohelp-collect-notify-email').innerText();assert.match(copy,/Receive an email/);}
  const gap=await page.locator('.happytohelp-interact').evaluate(panel=>{const root=panel.getRootNode(),p=panel.getBoundingClientRect(),b=[...root.querySelectorAll('.happytohelp-chat-box')].at(-1).getBoundingClientRect();return {right:p.right-b.right,left:b.left-p.left}});
  assert.ok(gap.right>0,'actual message bubble retains a positive right gutter');assert.ok(gap.left>=0);
  await audit(page,evidence,`${width}-${mailMode}-widget`);
  return {width,mailMode,bubbleRightGutter:gap.right,avatarCountWhileOpen:geometry.avatars.length};
 }finally{await context.close();}
}
