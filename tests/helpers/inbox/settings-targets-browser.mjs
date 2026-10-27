import assert from 'node:assert/strict';

// Measure the element receiving the click, including a checkbox's associated label.
async function targets(page, selector, records) {
 for (const control of await page.locator(selector).all()) {
  if (!await control.isVisible()) continue;
  const rectangle=await control.boundingBox(),name=(await control.textContent()).trim();
  records.push({name,width:rectangle.width,height:rectangle.height});
  assert.ok(rectangle.width>=44 && rectangle.height>=44,`${name}: target is ${rectangle.width} by ${rectangle.height}`);
  const focusable=control.locator('input');
  const keyboard=await focusable.count()?focusable:control;
  // Reach each control from the preceding tab stop, rather than programmatic focus alone.
  await keyboard.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
  assert.equal(await keyboard.evaluate(el=>el===document.activeElement),true,`${name}: reachable with Tab`);
  assert.equal(await control.evaluate(el=>{
   const focused=el.matches(':focus-visible')?el:el.querySelector(':focus-visible');
   const style=getComputedStyle(el.matches('label')?el:focused||el);
   return Boolean(focused) && (style.outlineStyle!=='none' || style.boxShadow!=='none');
  }),true,`${name}: visible keyboard focus`);
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Settings fits the viewport');
}

async function tooltips(page) {
 for (const control of await page.locator('[data-tooltip]').all()) {
  if (!await control.isVisible() || (await control.innerText()).trim()) continue;
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
 for (const width of [1440,390]) {
  await page.setViewportSize({width,height:900});
  await page.goto(origin+`/projects/${tenant.projectId}/edit`);
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  const appearance=[];
  await targets(page,'.project-mode-control button,.project-appearance .btn-link,.project-appearance summary',appearance);
  const disclosure=page.locator('.project-appearance summary');
  await disclosure.focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('.project-appearance details').getAttribute('open'),'');
  await page.keyboard.press('Enter');assert.equal(await page.locator('.project-appearance details').getAttribute('open'),null);
  await tooltips(page);
  await audit(page,`${width}-appearance-targets`);
  await page.getByRole('button',{name:'Availability',exact:true}).click();
  const availability=[];
  await targets(page,'.project-days label,.project-parity-narrow .form-check-label',availability);
  const monday=page.getByRole('checkbox',{name:'Monday',exact:true});
  const previous=await monday.isChecked();
  await monday.focus();await page.keyboard.press('Space');assert.equal(await monday.isChecked(),!previous);
  await page.getByLabel('Opening time',{exact:true}).fill('09:00');await page.getByLabel('Closing time',{exact:true}).fill('17:00');
  await page.getByRole('button',{name:'Update',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();
  await page.reload();await page.getByRole('button',{name:'Availability',exact:true}).click();
  assert.equal(await monday.isChecked(),!previous,'weekday survives saving and reload');
  assert.equal(await page.getByLabel('Opening time',{exact:true}).inputValue(),'09:00');
  assert.equal(await page.getByLabel('Closing time',{exact:true}).inputValue(),'17:00');
  await targets(page,'.project-days label,.project-parity-narrow .form-check-label',[]);
  await tooltips(page);
  await audit(page,`${width}-availability-targets-saved`);
  measurements.push({width,appearance,availability});
 }
 console.log('Settings targets:',JSON.stringify(measurements));
}
