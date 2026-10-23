import assert from 'node:assert/strict';

const save = async page => {
  const creating=new URL(page.url()).pathname.endsWith('/create')&&!new URL(page.url()).pathname.includes('/agents/');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname.startsWith('/api/')&&['POST','PUT','PATCH'].includes(r.request().method()));
  await page.getByRole('button', {name: /^(Save|Update|Create|Add|Invite)$/}).click();
  assert.equal((await response).ok(),true,'form mutation accepted');
  if(creating)await page.waitForURL(url=>!url.pathname.endsWith('/create'));
  else await page.getByText('Saved.', {exact:true}).waitFor();
};

export async function verifySettingsParity(page, {origin,projectId,checks}) {
  // Open only on a weekday that is neither today nor tomorrow in UTC, so the saved schedule is closed now.
  const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],today=new Date().getUTCDay(),openDay=weekdays[(today+3)%7];
  const mutations=[];
  const observe=request=>{if(request.url().includes('/api/management/') && ['POST','PUT','PATCH','DELETE'].includes(request.method()))mutations.push(request.method());};
  page.on('request',observe);
  try {
    await page.getByRole('button',{name:'Appearance',exact:true}).click();
    await page.getByLabel('Workspace color hex').fill('#327654');
    await page.getByRole('button',{name:'Dark',exact:true}).click();
    await page.getByRole('button',{name:'Availability',exact:true}).click();
    await page.getByLabel('Use opening hours',{exact:true}).check();
    await page.getByLabel(openDay,{exact:true}).check();
    await page.getByLabel('Opening time').fill('09:30');
    await page.getByLabel('Closing time').fill('17:15');
    await page.getByLabel('Away message outside hours',{exact:true}).fill('We return during our published support hours.');
    await page.getByRole('button',{name:'General',exact:true}).click();
    assert.equal(await page.getByLabel('Website',{exact:true}).inputValue(),'https://example.test');
    assert.deepEqual(mutations,[],'tabs and display buttons must not submit settings');
    await page.getByRole('button',{name:'Appearance',exact:true}).click();
    await save(page);
    assert.deepEqual(mutations,['PUT'],'Appearance Update performs one durable write');
    await page.getByRole('button',{name:'Availability',exact:true}).click();
    await save(page);
  } finally {page.off('request',observe);}
  await page.reload();
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  assert.equal(await page.getByLabel('Workspace color hex').inputValue(),'#327654');
  assert.equal(await page.getByRole('button',{name:'Dark',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Availability',exact:true}).click();
  assert.equal(await page.getByLabel('Use opening hours',{exact:true}).isChecked(),true);
  assert.equal(await page.getByLabel('Opening time').inputValue(),'09:30');
  assert.equal(await page.getByLabel('Closing time').inputValue(),'17:15');
  assert.equal(await page.getByLabel('Away message outside hours',{exact:true}).inputValue(),'We return during our published support hours.');
  // The widget's own settings door applies the saved schedule now: closed, with the custom away message.
  const project=await (await page.request.get(`${origin}/api/identity/projects/${projectId}`)).json();
  const widget=await (await page.request.get(`${origin}/api/widget/settings?widgetKey=${encodeURIComponent(project.widget_key)}`)).json();
  const {available,message,scheduled,opensAt}=widget.availability;
  assert.deepEqual({available,message,scheduled},{available:false,message:'We return during our published support hours.',scheduled:true},'the widget is told the workspace is away, with its message');
  assert.equal(new Date(opensAt).toLocaleDateString('en-US',{weekday:'long',timeZone:'UTC'}),openDay,'and when the team is back');
  // The tab says the same thing in words before anything is saved.
  await page.getByRole('status').filter({hasText:'Right now:'}).filter({hasText:`Away. Back ${openDay} at 9:30 AM`}).waitFor();
  checks.push('project tabs preserve unsaved edits without submitting; color, mode and schedule survive reload; the widget settings door and the tab report the saved schedule as away now, with when the team is back');
}

export async function verifyManagementParity(page,{origin,projectId,checks}) {
  const base=`${origin}/projects/${projectId}`;
  await page.goto(`${base}/plugins/create`);
  await page.getByLabel('Name',{exact:true}).fill('Parity plugin');
  await page.getByLabel('URL',{exact:true}).fill('https://example.test/plugin');
  await save(page);
  await page.reload();
  assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Parity plugin');
  assert.equal(await page.getByLabel('URL',{exact:true}).inputValue(),'https://example.test/plugin');
  assert.equal(await page.getByRole('button',{name:'Delete',exact:true}).getAttribute('type'),'button');
  await page.getByLabel('Name',{exact:true}).fill('Parity plugin updated');
  await save(page);await page.reload();
  assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Parity plugin updated');
  checks.push('plugin create and update survive reload; delete cannot implicitly submit');
  await page.goto(`${base}/agents/create`);
  await page.getByLabel('Email',{exact:true}).fill('parity-agent@example.test');
  await page.getByLabel('Role',{exact:true}).selectOption('admin');
  await save(page);
  await page.getByText('Invitation created.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Invite',exact:true}).isDisabled(),true);
  await page.goto(`${base}/agents`);
  await page.getByText('parity-agent@example.test',{exact:true}).waitFor();
  await page.reload();
  await page.getByText('parity-agent@example.test',{exact:true}).waitFor();
  checks.push('admin agent invitation persists and prevents duplicate submission');
}

export async function verifyMobileNavigation(page,{origin,projectId,checks}) {
  const nav=page.getByRole('navigation',{name:'Main navigation'});
  await nav.getByRole('button',{name:'Toggle navigation'}).click();
  assert.equal(await nav.getByRole('button',{name:'Toggle navigation'}).getAttribute('aria-expanded'),'true');
  await nav.getByRole('link',{name:'Contacts',exact:true}).click();
  await page.waitForURL(`**/projects/${projectId}/contacts`);
  // The URL commits while Contacts still loads; the account menu closes when the page arrives.
  await page.getByRole('heading',{level:1,name:'Contacts',exact:true}).waitFor();
  const account=page.locator('.navbar-user.d-xl-none').getByRole('button',{name:'Account menu'});
  await account.click();
  await page.getByRole('link',{name:'Profile',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await account.getAttribute('aria-expanded'),'false');
  await nav.getByRole('button',{name:/Switch workspace:/}).click();
  await nav.getByRole('button',{name:'Global Inbox',exact:true}).click();
  await page.waitForURL(`${origin}/conversations`);
  await nav.getByRole('button',{name:'Switch workspace: Global Inbox'}).click();
  await nav.getByRole('button',{name:'UI Acceptance Workspace',exact:true}).click();
  await page.waitForURL(`**/projects/${projectId}/conversations`);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  checks.push('mobile navigation, account Escape dismissal and global/project workspace switching');
}

export async function verifyKnowledgeParity(page,{origin,projectId,checks}) {
  await page.goto(`${origin}/projects/${projectId}/categories/create`);
  await page.getByLabel('Title',{exact:true}).fill('Browser category');
  await page.getByLabel('Summary',{exact:true}).fill('Persisted category summary');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.waitForURL(url=>url.pathname.includes('/categories/')&&!url.pathname.endsWith('/create'));
  await page.reload();
  assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'Browser category');
  await page.getByLabel('Summary',{exact:true}).fill('Updated category summary');
  await save(page);await page.reload();
  assert.equal(await page.getByLabel('Summary',{exact:true}).inputValue(),'Updated category summary');
  checks.push('knowledge category create and edit survive reload');
}

export async function verifyAssistantParity(page,{origin,projectId,checks}) {
  const base=`${origin}/projects/${projectId}/ais`;
  await page.goto(`${base}/create`);
  for(const [label,value] of [['Name','Browser assistant'],['Role','Account support'],['Model','gpt-5-mini'],['Prompt','Answer account questions using the published knowledge.']])await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForURL(url=>url.pathname.includes('/ais/')&&!url.pathname.endsWith('/create'));
  await page.reload();
  assert.equal(await page.getByLabel('Role',{exact:true}).inputValue(),'Account support');
  const id=new URL(page.url()).pathname.split('/').pop();
  await page.goto(base);
  assert.equal(await page.getByLabel('Allow human responders',{exact:true}).isChecked(),true,'saving an unset policy must retain runtime human responder default');
  await page.getByLabel('Default responder for non-logged in users',{exact:true}).selectOption(id);
  await save(page);await page.reload();
  assert.equal(await page.getByLabel('Default responder for non-logged in users',{exact:true}).inputValue(),id);
  assert.equal(await page.getByLabel('Allow human responders',{exact:true}).isChecked(),true);
  await page.getByLabel('Default responder for non-logged in users',{exact:true}).selectOption('-');await save(page);
  const toggle=page.locator('.settings-section').filter({has:page.getByRole('heading',{name:'Browser assistant',exact:true})}).getByRole('checkbox',{name:'Enable assistant',exact:true});
  await Promise.all([page.waitForResponse(r=>r.url().endsWith(`/ais/${id}`)&&r.request().method()==='PUT'),toggle.click()]);await page.reload();
  assert.equal(await toggle.isChecked(),false);
  await Promise.all([page.waitForResponse(r=>r.url().endsWith(`/ais/${id}`)&&r.request().method()==='PUT'),toggle.click()]);await page.reload();
  assert.equal(await toggle.isChecked(),true);
  checks.push('assistant create, human default preservation, default responder and enabled switch persist');
}
