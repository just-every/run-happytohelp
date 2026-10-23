import assert from 'node:assert/strict';
import {campaignsBrowser} from './campaigns-browser.mjs';
import {assistantBrowser} from './assistant-browser.mjs';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {assertLauncherAvatarFits} from '../widget-launcher-geometry.mjs';
import {createRuntime} from '../emitted-runtime.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs'
// The widget settings editor, its live preview and the installed widget agree.
export async function settingsJourney(){

// Widget settings must show what the widget renders, edit one value at a time, save only edits,
// and every project must have a server secret that its owner can reveal and copy.
const defaults={
 theme:{'avatar][background':'#b2e2ff','insight][background':'#ffffff','insight][color':'#333333','button][open][color':'#667085','button][open][background':'#f5f6fb','button][closed][color':'#ffffff','button][closed][background':'#484748','window][background':'#ffffff','window][color':'#000000','chat][agent][background':'#f1f9ff','chat][agent][color':'#000000','chat][user][background':'#2ca1e5','chat][user][color':'#ffffff','input][message][background':'#f5f6fb','input][message][color':'#666666','input][send][background':'#484748','input][send][color':'#ffffff','input][button][color':'#667085'},
};
const color=name=>`input[name="theme[${name}]"]`;
const themeDefaults=Object.fromEntries(Object.entries(defaults.theme).map(([name,value])=>[color(name),value]));
const textDefaults={'text[message][placeholder_message]':'Send a message...','text[message][button_send]':'Send','text[chat][return_title]':'Continue Conversation','text[chat][return_last_message]':'Last message','text[chat][sending_images]':'Sending images...','text[errors][connection]':'Sorry we could not connect to the server. Please check your connection and try again.','text[prompt][email_prompt]':'Receive an email when {agent_name} replies!','text[ai][human_response]':'Responds within 24 hours'};
const switchDefaults={'settings[show_glow][on_insight]':true,'settings[show_glow][on_insight_reply]':true,'settings[show_glow][on_ai_typing]':false,'settings[show_glow][on_human_typing]':false,'settings[message][collect_screenshot]':true,'settings[message][collect_attachments]':true,'settings[collect][require_name]':false,'settings[collect][require_email]':false};

const evidenceDir=resolve(process.env.H2H_EVIDENCE_DIR||'test-results','widget-settings');
await mkdir(evidenceDir,{recursive:true});
const runtime=await createRuntime({port:Number(process.env.H2H_TEST_PORT||0)});const origin=runtime.origin;let success=false;
const call=async(path,body,token,method=body===undefined?'GET':'POST')=>{const r=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(r.ok,`${path}: ${r.status}`);return r.json()};
const f={email:'widget-settings@example.test',password:'synthetic-widget-settings-test-password-2026'};
const setup=await call('/api/identity/bootstrap',{password:f.password,name:'Widget Settings Workspace',email:f.email,allowedOrigin:origin});
const owner=await call('/api/identity/login',{email:f.email,password:f.password});
// Setup gives every new workspace a colour; clear it so the first checks read the widget's own defaults.
await call(`/api/management/projects/${setup.projectId}/settings`,{primary_color:''},owner.token,'PUT');
const settingsApi=(projectId=setup.projectId)=>call(`/api/management/projects/${projectId}/widget-settings`,undefined,owner.token);
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();
const errors=[],puts=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/management/projects/*/widget-settings',async route=>{const request=route.request();if(request.method()==='PUT')puts.push(JSON.parse(request.postData()));await route.continue()});
const preview=page.locator('#happytohelp');
const previewStyle=(selector,property)=>preview.locator(selector).first().evaluate((element,name)=>getComputedStyle(element)[name],property);
const open=async()=>{await page.goto(`${origin}/projects/${setup.projectId}/widget-settings`);await page.locator('#widget-settings-tabs').waitFor();await preview.locator('.happytohelp-send-message-conversation').waitFor({state:'attached'})};
const tab=name=>page.getByRole('tab',{name,exact:true}).click();
const save=async()=>{const before=puts.length;await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();assert.equal(puts.length,before+1);return puts.at(-1)};
const value=selector=>page.locator(selector).inputValue();
const assertThemeDefaults=async(except={})=>{for(const [selector,expected] of Object.entries(themeDefaults))assert.equal(await value(selector),except[selector]??expected,selector)};
const previewState=name=>page.getByRole('group',{name:'Preview state'}).getByRole('button',{name,exact:true}).click();
const launcher=preview.locator('.happytohelp-button').first();
// The widget renders inside a shadow root, so poll through the piercing locator rather than document.querySelector.
const launcherBackground=async expected=>{let actual;for(const deadline=Date.now()+5000;Date.now()<deadline;await page.waitForTimeout(100)){actual=await launcher.evaluate(element=>getComputedStyle(element).backgroundColor);if(actual===expected)return}assert.equal(actual,expected,'closed launcher background in the preview')};
const checks=[];
try{
 await page.goto(origin+'/login?returnTo='+encodeURIComponent(`/projects/${setup.projectId}/conversations`));await page.getByLabel('Email',{exact:true}).fill(f.email);await page.getByLabel('Password',{exact:true}).fill(f.password);await page.getByRole('button',{name:'Login',exact:true}).click();await page.waitForURL(/\/conversations/);

 // A project made by setup already has a server secret and no saved widget settings.
 const initial=await settingsApi();assert.deepEqual(initial.settings,{});assert.match(initial.verificationSecret,/^[0-9a-f]{64}$/);checks.push('setup project has a 256-bit server secret');
 const second=await call('/api/management/projects',{name:'Second project',allowed_origin:'https://second.example.test'},owner.token);
 const secondSettings=await settingsApi(second.id);assert.match(secondSettings.verificationSecret,/^[0-9a-f]{64}$/);assert.notEqual(secondSettings.verificationSecret,initial.verificationSecret);checks.push('created project has its own server secret');

 await open();
 // Advanced retains the secret controls after the initial install snippet.
 await page.locator('.widget-code__advanced > summary').click();
 const reveal=page.getByRole('button',{name:'Reveal server secret'}),copy=page.getByRole('button',{name:'Copy server secret'});
 assert.equal(await reveal.isEnabled(),true);assert.equal(await copy.isEnabled(),true);
 await page.screenshot({path:join(evidenceDir,'desktop-code-secret.png'),fullPage:true});
 await reveal.click();await page.locator('.widget-code__secret-value code').filter({hasText:initial.verificationSecret}).waitFor();
 await copy.click();await page.locator('.widget-code__copy-feedback').filter({hasText:/\S/}).waitFor();
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),initial.verificationSecret);
 await page.getByRole('button',{name:'Hide server secret'}).click();await page.locator('.widget-code__secret-value code').filter({hasText:'••••'}).waitFor();checks.push('Reveal and Copy secret work for the owner');

 // Theme tab: effective defaults, not black.
 await tab('Theme');await assertThemeDefaults();await page.screenshot({path:join(evidenceDir,'desktop-theme-defaults.png'),fullPage:true});checks.push('all 18 theme swatches show widget defaults');
 // The preview renders the same defaults in both its Conversation and Launcher views.
 assert.equal(await previewStyle('button[name=submit]','backgroundColor'),'rgb(72, 71, 72)');
 await previewState('Launcher');await preview.locator('.happytohelp-button.happytohelp-avatar').waitFor();assert.ok(initial.previewAgent?.id,'the preview uses the actual workspace responder');assert.equal(await preview.locator('.happytohelp-button .happytohelp-agent-avatar').count()>0,true,'closed preview launcher shows the real responder avatar');
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.waitForTimeout(400);await assertLauncherAvatarFits(launcher)}
 await page.setViewportSize({width:1440,height:900});
 await launcherBackground('rgb(72, 71, 72)');await page.screenshot({path:join(evidenceDir,'desktop-theme-launcher.png'),fullPage:true});
 await previewState('Conversation');checks.push('preview renders the default theme in Conversation and Launcher views');

 // Texts and Settings tabs show effective values.
 await tab('Texts');const texts=page.locator('.tab-pane.active input[type=text]');assert.equal(await texts.count(),43);
 for(const input of await texts.all()){assert.notEqual(await input.inputValue(),'',await input.getAttribute('name'));assert.equal(await input.getAttribute('placeholder'),await input.inputValue(),await input.getAttribute('name'))}
 for(const [name,expected] of Object.entries(textDefaults))assert.equal(await value(`input[name="${name}"]`),expected,name);
 await page.screenshot({path:join(evidenceDir,'desktop-texts-defaults.png'),fullPage:true});
 await tab('Settings');for(const [name,expected] of Object.entries(switchDefaults))assert.equal(await page.locator(`input[name="${name}"]`).isChecked(),expected,name);
 await page.screenshot({path:join(evidenceDir,'desktop-settings-defaults.png'),fullPage:true});checks.push('texts show default copy and settings toggles show default state');

 // Saving without edits stores nothing and leaves the widget on its defaults.
 assert.deepEqual(await save(),{});assert.deepEqual((await settingsApi()).settings,{});checks.push('save without edits stores no overrides');
 await open();await tab('Theme');await assertThemeDefaults();

 // One edit changes one value in the form; the preview composer keeps its default colours.
 await tab('Theme');await page.locator(color('avatar][background')).fill('#ff0000');
 await assertThemeDefaults({[color('avatar][background')]:'#ff0000'});
 assert.equal(await previewStyle('button[name=submit]','backgroundColor'),'rgb(72, 71, 72)');
 assert.equal(await previewStyle('textarea','backgroundColor'),'rgb(245, 246, 251)');
 await page.screenshot({path:join(evidenceDir,'desktop-theme-one-edit.png'),fullPage:true});checks.push('one color edit leaves every other color and the preview composer on defaults');

 // Save the edit with a text change and a switched-off default-on toggle.
 await tab('Texts');await page.locator('input[name="text[message][button_send]"]').fill('Deliver');
 await tab('Settings');await page.locator('input[name="settings[show_glow][on_insight]"]').uncheck();
 const expected={theme:{avatar:{background:'#ff0000'}},text:{message:{button_send:'Deliver'}},settings:{show_glow:{on_insight:false}}};
 assert.deepEqual(await save(),expected);assert.deepEqual((await settingsApi()).settings,expected);checks.push('save stores exactly the edited fields across all three tabs');
 await open();await tab('Theme');await assertThemeDefaults({[color('avatar][background')]:'#ff0000'});
 await tab('Texts');assert.equal(await value('input[name="text[message][button_send]"]'),'Deliver');assert.equal(await value('input[name="text[message][placeholder_message]"]'),'Send a message...');
 await tab('Settings');for(const [name,fallback] of Object.entries(switchDefaults))assert.equal(await page.locator(`input[name="${name}"]`).isChecked(),name==='settings[show_glow][on_insight]'?false:fallback,name);
 assert.deepEqual(await save(),expected);checks.push('reload keeps edits and defaults, and saving again changes nothing');

 // Putting a value back to the default, or emptying a text, removes the override.
 await tab('Theme');await page.locator(color('avatar][background')).fill('#b2e2ff');
 await tab('Texts');await page.locator('input[name="text[message][button_send]"]').fill('');
 assert.deepEqual(await save(),{settings:{show_glow:{on_insight:false}}});assert.deepEqual((await settingsApi()).settings,{settings:{show_glow:{on_insight:false}}});checks.push('restoring a default or clearing a text removes the override');

 // Editing the closed launcher background shows in the Launcher view.
 await tab('Theme');await previewState('Launcher');await launcherBackground('rgb(72, 71, 72)');
 await page.locator(color('button][closed][background')).fill('#123456');await launcherBackground('rgb(18, 52, 86)');
 await page.screenshot({path:join(evidenceDir,'desktop-theme-launcher-edit.png'),fullPage:true});checks.push('closed launcher background edit shows in the Launcher preview');

 // Mobile: the secret and tabs work at phone width.
 await page.setViewportSize({width:390,height:844});await open();await page.locator('.widget-code__advanced > summary').click();
 assert.equal(await page.getByRole('button',{name:'Reveal server secret'}).isEnabled(),true);
 await page.screenshot({path:join(evidenceDir,'mobile-code-secret.png'),fullPage:true});
 await tab('Theme');await assertThemeDefaults();await page.screenshot({path:join(evidenceDir,'mobile-theme-defaults.png'),fullPage:true});checks.push('mobile layout shows the secret and default theme');
 // The preview uses the actual workspace responder, without a fabricated conversation.
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===1440?900:844});await open();await tab('Theme');
  assert.equal(await preview.locator('.happytohelp-chat-header .happytohelp-insight-agent-name').innerText(),initial.previewAgent.first_name??initial.previewAgent.name);
  const responseInfo=preview.locator('.happytohelp-chat-header .happytohelp-insight-agent-info');
  // The existing mobile header places its visible separator inside the response-copy container.
  const separator=responseInfo.locator('.happytohelp-insight-agent-seperator-tiny');
  assert.equal(await separator.textContent(),'•');assert.equal(await separator.isVisible(),width===390);
  assert.equal(await responseInfo.innerText(),width===390?'•Responds within 24 hours':'Responds within 24 hours');
 }
 checks.push('real workspace responder name and response copy appear in settings preview at desktop and mobile widths');

 // Workspace accent is an effective default: display it without storing it as an override.
 await call(`/api/management/projects/${setup.projectId}/settings`,{primary_color:'#204b3a'},owner.token,'PUT');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===1440?900:844});await open();await tab('Theme');
  assert.equal(await value(color('input][send][background')),'#204b3a');
  assert.equal(await value(color('button][closed][background')),'#204b3a');
  assert.equal(await previewStyle('button[name=submit]','backgroundColor'),'rgb(32, 75, 58)');
  await page.locator(color('avatar][background')).fill('#112233');
  assert.equal(await value(color('input][send][background')),'#204b3a');
  assert.equal(await previewStyle('button[name=submit]','backgroundColor'),'rgb(32, 75, 58)');
  const stored=await save();assert.deepEqual(stored,{settings:{show_glow:{on_insight:false}},theme:{avatar:{background:'#112233'}}});
  await open();await tab('Theme');assert.equal(await value(color('input][send][background')),'#204b3a');
  await page.locator(color('input][send][background')).fill('#123456');await save();
  await open();await tab('Theme');assert.equal(await value(color('input][send][background')),'#123456');
  assert.equal(await previewStyle('button[name=submit]','backgroundColor'),'rgb(18, 52, 86)');
  await page.locator(color('input][send][background')).fill('#204b3a');
  assert.deepEqual(await save(),{settings:{show_glow:{on_insight:false}},theme:{avatar:{background:'#112233'}}});
 }
 checks.push('workspace inherited swatches match preview, one-field save and reload, and explicit override removal at desktop and mobile widths');
 // Additional real image case after the unchanged settings/initials fixture checks.
 const responderAvatar=origin+'/homepage/media/brands/happytohelp-favicon.png';
 await runtime.execute(`INSERT INTO user_settings(user_id,avatar_url) VALUES('${initial.previewAgent.id}','${responderAvatar}') ON CONFLICT(user_id) DO UPDATE SET avatar_url=excluded.avatar_url`);
 for(const background of [{name:'default',accent:'',color:defaults.theme['button][closed][background']},{name:'themed',accent:'#204b3a',color:'#204b3a'}]){
  await call(`/api/management/projects/${setup.projectId}/settings`,{primary_color:background.accent},owner.token,'PUT');
  const expectedBackground=`rgb(${background.color.slice(1).match(/../g).map(channel=>parseInt(channel,16)).join(', ')})`;
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===1440?900:844});await open();await tab('Theme');await previewState('Launcher');
   assert.equal(await value(color('button][closed][background')),background.color,`${background.name} launcher swatch at ${width}`);await launcherBackground(expectedBackground);
   const image=launcher.locator('.happytohelp-agent-avatar img');await image.waitFor();assert.equal(await image.getAttribute('src'),responderAvatar);await image.evaluate(image=>image.decode());
   await page.waitForTimeout(400);const geometry=await assertLauncherAvatarFits(launcher);assert.equal(geometry.images.length,1,'the real responder image fills all four launcher edges');
   assert.equal(await launcher.evaluate(element=>getComputedStyle(element).backgroundColor),expectedBackground,`${background.name} launcher background at ${width}`);
   await page.screenshot({path:join(evidenceDir,`${width}-launcher-image-${background.name}-edges.png`),fullPage:true});
  }
 }
 checks.push('real responder initials and image fill all four launcher edges within half a pixel with a round clip at 1440 and 390, with image coverage on default and themed backgrounds');
 await campaignsBrowser({browser,page,origin,projectId:setup.projectId,owner,evidenceDir});
 await assistantBrowser({browser,evidenceDir});
 assert.deepEqual(errors,[]);success=true;
}finally{await browser.close();await runtime.close(success)}

}
