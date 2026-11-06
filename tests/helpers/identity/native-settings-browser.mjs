import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {evidence} from '../../journeys/kit/browser.mjs'

// Extends the existing brand Settings journey; assertions run at 1440 only.
export async function nativeSettingsBrowser({runtime,browser,owner}){
 const {origin}=runtime,P=`/api/management/projects/${owner.projectId}`,url=origin+`/projects/${owner.projectId}/settings`,shot=await evidence('native-settings'),proof=[]
 const request=async(path,token,body,method=body===undefined?'GET':'PUT')=>{
  const response=await fetch(origin+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
  assert.equal(response.status,200,`${method} ${path}`);return (await response.json()).data
 }
 const members={owner},quote=value=>"'"+String(value).replaceAll("'","''")+"'",now=Date.now(),sql=[]
 const roleId=randomUUID()
 sql.push(`INSERT INTO project_roles(id,project_id,name,base,permissions_json,created_at,updated_at) VALUES(${[roleId,owner.projectId,'Synthetic narrow admin','admin','[]',now,now].map(quote).join(',')})`)
 for(const kind of ['admin','operator','collaborator','custom-admin']){
  const userId=randomUUID(),token=randomUUID(),role=kind.includes('admin')?'admin':'operator',hash=createHash('sha256').update(token).digest('hex')
  members[kind]={userId,token}
  sql.push(`INSERT INTO users(id,email,name,created_at) VALUES(${[userId,kind+'-settings-'+userId+'@example.test','Synthetic '+kind,now].map(quote).join(',')})`,`INSERT INTO memberships VALUES(${[owner.projectId,userId,role].map(quote).join(',')})`,`INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(${[hash,userId,owner.projectId,role,now+3600000].map(quote).join(',')})`,`INSERT INTO session_factors(token_hash,user_id,method,verified_at) VALUES(${[hash,userId,'password',now].map(quote).join(',')})`)
  if(kind==='collaborator'||kind==='custom-admin')sql.push(`INSERT INTO member_roles VALUES(${[owner.projectId,userId,kind==='collaborator'?'collaborator':roleId,now].map(quote).join(',')})`)
 }
 await runtime.execute(sql.join(';')+';')
 const values={website:'https://settings.example.test',timezone:'America/New_York',help_center_domain:'https://help.example.test/',primary_color:'#2468aa',display_mode:'light',brand_name:'Synthetic care',welcome_message:'Synthetic welcome',logo_url:origin+'/homepage/media/brands/happytohelp-favicon.png',avatar_url:origin+'/homepage/media/brands/happytohelp-favicon.png',brand_image_url:'/homepage/media/brands/happytohelp-favicon.png',sidebar_artwork_enabled:false,is_contact_tracking_enabled:true,proactive_help_enabled:true,is_available:false,unavailable_message:'Synthetic closed',is_availability_schedule_enabled:true,availability_schedule:{days:[1,3,5],time_from:'08:30',time_to:'17:45',message:'Synthetic outside hours'},is_presence_away_enabled:false,presence_idle_minutes:10,presence_away_message:'Synthetic nobody online'}
 await request(P+'/settings',owner.token,values)
 await request(P+'/availability',owner.token,values)
 const capture=async(page,name)=>{
  for(const width of process.env.H2H_SETTINGS_PROOF==='1'?[1440,390]:[1440]){
   await page.setViewportSize({width,height:900})
   await page.evaluate(()=>window.scrollTo(0,0))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits viewport')
   await page.screenshot({path:shot(`${name}-${width}.png`),fullPage:true})
   const metrics=await page.locator('main').evaluateAll(nodes=>{
    const root=nodes[0]||document.body,visible=el=>el.getClientRects().length>0
    return {minText:Math.min(...[...root.querySelectorAll('label,p,button,input,select,summary,[role=alert]')].filter(visible).map(el=>parseFloat(getComputedStyle(el).fontSize))),smallTargets:[...root.querySelectorAll('button,input,select,summary')].filter(visible).filter(el=>{const r=el.getBoundingClientRect();return r.width<44||r.height<44}).length}
   })
   proof.push({name,width,...metrics})
  }
  await page.setViewportSize({width:1440,height:900})
 }
 for(const kind of ['owner','admin']){
  const context=await browser.newContext({viewport:{width:1440,height:900}})
  try{
   await context.addCookies([{name:'h2h_session',value:members[kind].token,url:origin}])
   const page=await context.newPage();page.setDefaultTimeout(20000)
   await page.goto(url)
   assert.equal(await page.getByLabel('Website',{exact:true}).inputValue(),values.website)
   assert.equal(await page.getByLabel('Timezone',{exact:true}).inputValue(),values.timezone)
   assert.equal(await page.getByLabel('Track contact page views with widget',{exact:true}).isChecked(),true)
   assert.equal(await page.getByLabel('Offer proactive help after visitor consent',{exact:true}).isChecked(),true)
   const name=page.getByLabel('Name',{exact:true});await name.fill('Synthetic '+kind+' saved');await name.focus()
   assert.equal(await name.evaluate(el=>el===document.activeElement),true)
   assert.ok(await name.evaluate(el=>{const style=getComputedStyle(el);return style.outlineStyle!=='none'||style.boxShadow!=='none'}),'keyboard focus is visible')
   await capture(page,kind+'-general')
   await page.getByRole('button',{name:'Update',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
   assert.equal((await request(P+'/settings',members[kind].token)).name,'Synthetic '+kind+' saved')
   await page.getByRole('button',{name:'Appearance',exact:true}).click()
   assert.equal(await page.getByLabel('Workspace color hex',{exact:true}).inputValue(),values.primary_color)
   assert.equal(await page.getByRole('button',{name:'Light',exact:true}).getAttribute('aria-pressed'),'true')
   await page.getByText('Additional branding',{exact:true}).click()
   for(const [label,key] of [['Logo URL','logo_url'],['Public brand name','brand_name'],['Support avatar URL','avatar_url'],['Welcome greeting','welcome_message']])assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),values[key])
   assert.equal(await page.getByRole('img',{name:'Workspace brand',exact:true}).getAttribute('src'),values.brand_image_url)
   await capture(page,kind+'-appearance')
   await page.getByRole('button',{name:'Update',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
   await page.getByRole('button',{name:'Availability',exact:true}).click()
   assert.equal(await page.getByLabel('Use opening hours',{exact:true}).isChecked(),true)
   for(const [index,day] of ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].entries())assert.equal(await page.getByLabel(day,{exact:true}).isChecked(),values.availability_schedule.days.includes(index+1))
   for(const [label,value] of [['Opening time',values.availability_schedule.time_from],['Closing time',values.availability_schedule.time_to],['Away message outside hours',values.availability_schedule.message],['Away message when nobody is online',values.presence_away_message],['Away message while new conversations are off',values.unavailable_message]])assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),value)
   assert.equal(await page.getByLabel('Show away when no teammate is online',{exact:true}).isChecked(),false)
   assert.equal(await page.getByLabel('A teammate counts as away after',{exact:true}).inputValue(),String(values.presence_idle_minutes))
   assert.equal(await page.getByLabel('Accept new conversations',{exact:true}).isChecked(),false)
   await capture(page,kind+'-availability')
   await page.getByRole('button',{name:'Update',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
   const saved=await request(P+'/settings',members[kind].token)
   for(const [key,value] of Object.entries(values))assert.deepEqual(saved[key],value,kind+' retains '+key)
  }finally{await context.close()}
 }
 for(const kind of ['collaborator','operator','custom-admin']){
  const context=await browser.newContext({viewport:{width:1440,height:900}})
  try{
   await context.addCookies([{name:'h2h_session',value:members[kind].token,url:origin}])
   const page=await context.newPage();page.setDefaultTimeout(20000)
   const response=page.waitForResponse(r=>r.url()===origin+P+'/settings')
   await page.goto(url);assert.equal((await response).status(),403)
   await page.getByRole('alert').filter({hasText:/role|permission|owner|admin/i}).first().waitFor()
   assert.equal(await page.getByRole('button',{name:'Update',exact:true}).count(),0,'refusal exposes no editable Settings')
   await capture(page,kind+'-refused')
  }finally{await context.close()}
 }
 await writeFile(shot('proof.json'),JSON.stringify(proof,null,2))
 console.log('PROBE browser ACCESS-001: owner/admin load and save General, Appearance and Availability; collaborator/operator/custom-admin refused')
}
