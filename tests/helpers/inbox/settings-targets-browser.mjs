import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

// Measure the element receiving the click, including a checkbox's associated label.
async function targets(page, selector, records) {
 for (const control of await page.locator(selector).all()) {
  if (!await control.isVisible()) continue;
  const rectangle=await control.boundingBox(),name=(await control.textContent()).trim();
  records.push({name,width:rectangle.width,height:rectangle.height});
  assert.ok(rectangle.width>=44 && rectangle.height>=44,`${name}: target is ${rectangle.width} by ${rectangle.height}`);
  const focusable=control.locator('input');
  const associated=await control.getAttribute('for');
  const keyboard=associated?page.locator(`[id="${associated}"]`):await focusable.count()?focusable:control;
  // Reach each control from the preceding tab stop, rather than programmatic focus alone.
  await keyboard.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
  assert.equal(await keyboard.evaluate(el=>el===document.activeElement),true,`${name}: reachable with Tab`);
  assert.equal(await control.evaluate(el=>{
   const focused=el.matches(':focus-visible')?el:el.control?.matches(':focus-visible')?el.control:el.querySelector(':focus-visible');
   const styles=[el,focused].filter(Boolean).map(node=>getComputedStyle(node));
   return Boolean(focused) && styles.some(style=>style.outlineStyle!=='none' || style.boxShadow!=='none');
  }),true,`${name}: visible keyboard focus`);
  if(await keyboard.evaluate(el=>el.matches('input[type=checkbox]'))) {
   assert.equal(await keyboard.evaluate(el=>{
    const input=getComputedStyle(el),label=getComputedStyle(el.labels[0]);
    return input.boxShadow!=='none' && label.outlineStyle==='none' && label.boxShadow==='none';
   }),true,`${name}: one focus ring on the checkbox`);
  }
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Settings fits the viewport');
}

async function tooltips(page) {
 for (const control of await page.locator('[data-tooltip]').all()) {
  if (!await control.isVisible() || ((await control.innerText()).trim() && !await control.evaluate(el=>el.matches('.native-profile-toggle')))) continue;
  const label=await control.getAttribute('aria-label');
  assert.ok(label?.trim().split(/\s+/).length>=2,'icon control has a short tooltip');
  await page.mouse.move(0,0);await page.keyboard.press('Escape');
  await control.hover();await page.getByRole('tooltip',{includeHidden:true}).filter({hasText:label}).waitFor({state:'visible'});
  await page.mouse.move(0,0);await control.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('tooltip',{includeHidden:true}).filter({hasText:label}).isVisible(),true,'keyboard tooltip is immediate');
  await page.keyboard.press('Escape');
 }
}

export async function settingsTargetsBrowser({page,origin,tenant,audit}) {
 const measurements=[];
 for (const width of [1440]) {
  await page.setViewportSize({width,height:900});
  await page.goto(origin+`/projects/${tenant.projectId}/edit`);
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.locator('.workspace-brand input[type=file]').setInputFiles('public/homepage/media/brands/happytohelp-favicon.png');
  await page.getByRole('button',{name:'Remove',exact:true}).waitFor();
  const appearance=[];
  await targets(page,'.project-mode-control button,.project-appearance .btn-link,.project-appearance summary',appearance);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  assert.equal(await page.locator('.workspace-brand__preview img').count(),0,'Undo restores the original brand image');
  const mode=width===1440?'Light':'Balanced';
  await page.getByRole('button',{name:mode,exact:true}).focus();await page.keyboard.press('Space');
  await page.getByRole('button',{name:'Update',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();
  await page.reload();await page.getByRole('button',{name:'Appearance',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:mode,exact:true}).getAttribute('aria-pressed'),'true','display mode survives saving and reload');
  const disclosure=page.locator('.project-appearance summary');
  await disclosure.focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('.project-appearance details').getAttribute('open'),'');
  await page.keyboard.press('Enter');assert.equal(await page.locator('.project-appearance details').getAttribute('open'),null);
  await tooltips(page);
  await audit(page,`${width}-appearance-targets`);
  await page.getByRole('button',{name:'Availability',exact:true}).click();
  const availability=[];
  await targets(page,'.project-days label,.project-parity-narrow .form-switch > .form-check-label',availability);
  const monday=page.getByRole('checkbox',{name:'Monday',exact:true});
  const previous=await monday.isChecked();
  await monday.focus();await page.keyboard.press('Space');assert.equal(await monday.isChecked(),!previous);
  await page.getByLabel('Opening time',{exact:true}).fill('09:00');await page.getByLabel('Closing time',{exact:true}).fill('17:00');
  await page.getByRole('button',{name:'Update',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();
  await page.reload();await page.getByRole('button',{name:'Availability',exact:true}).click();
  assert.equal(await monday.isChecked(),!previous,'weekday survives saving and reload');
  assert.equal(await page.getByLabel('Opening time',{exact:true}).inputValue(),'09:00');
  assert.equal(await page.getByLabel('Closing time',{exact:true}).inputValue(),'17:00');
  await targets(page,'.project-days label,.project-parity-narrow .form-switch > .form-check-label',[]);
  await tooltips(page);
  await audit(page,`${width}-availability-targets-saved`);
  await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await page.getByLabel('Subject',{exact:true}).first().waitFor();
  const notifications=await page.locator('.project-parity-narrow').evaluate(form=>({
   height:form.getBoundingClientRect().height,
   checkboxes:[...form.querySelectorAll('.form-check')].map(label=>{
    const input=label.querySelector('input'),text=label.querySelector('.form-check-label');
    const range=document.createRange();range.selectNodeContents(text);
    const i=input.getBoundingClientRect(),r=range.getBoundingClientRect();
    return {name:text.textContent,centerDelta:(i.top+i.height/2)-(r.top+r.height/2)};
   }),
  }));
  for(const checkbox of notifications.checkboxes)assert.ok(Math.abs(checkbox.centerDelta)<=3,`${checkbox.name}: checkbox aligns with its text`);
  await audit(page,`${width}-notifications-alignment`);
  measurements.push({width,appearance,availability,notifications});
 }
 const directory=resolve(process.env.H2H_EVIDENCE_DIR||'./test-results/appearance');await mkdir(directory,{recursive:true});
 await writeFile(join(directory,'settings-targets.json'),JSON.stringify(measurements,null,2));
 console.log('Settings targets:',JSON.stringify(measurements));
}
