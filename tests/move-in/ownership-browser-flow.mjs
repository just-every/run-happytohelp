import assert from 'node:assert/strict';

export async function ownershipBrowserFlow({page,request,origin,token,width,inspect}){
 const project=(await request('/api/management/projects',{token,body:{name:'Migrated ownership '+width,allowedOrigin:origin}})).id;
 const previous=await request('/api/identity/session',{token});
 token=(await request('/api/identity/switch-project',{token,body:{projectId:project}})).token;
 const switched=await page.request.post(origin+'/api/identity/switch-project',{headers:{Origin:origin},data:{projectId:project}});assert.equal(switched.status(),200);
 try{
 const owner=await request('/api/identity/session',{token}),base=`/projects/${project}`,native=`/api/dashboard/projects/${project}`;
 const group=(await request(native+'/ticket-groups',{token,body:{name:'Parcel support',members:[owner.id]}})).data;
 const dates={created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'},name='ownership-'+width+'.jsonl';
 const rows=[{user:{id:1,role:'end-user',name:'Mara Chen',email:'ownership-'+width+'@example.test',created_at:dates.created_at}},...['solved','closed'].map((status,index)=>({ticket:{id:10+index,requester_id:1,subject:'Parcel '+status,assignee_id:77,group_id:88,status,via:{channel:'email'},...dates,comments:[{id:20+index,author_id:1,public:true,body:'Please check the parcel.',created_at:dates.created_at}]}}))];
 await page.setViewportSize({width,height:900});await page.goto(origin+base+'/move-in');
 await page.getByLabel('Export format',{exact:true}).selectOption('zendesk');await page.getByLabel('Export file',{exact:true}).setInputFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from(rows.map(JSON.stringify).join('\n'))});await page.getByRole('button',{name:'Upload and review',exact:true}).click();await page.getByRole('heading',{name:'Ready for review: '+name,exact:true}).waitFor({timeout:120000});await page.getByRole('button',{name:'Approve and import',exact:true}).click();await page.getByRole('heading',{name:'Complete: '+name,exact:true}).waitFor({timeout:120000});
 await page.locator('summary').filter({hasText:'Review imported ownership'}).click();await page.getByLabel('Source agent 77',{exact:true}).selectOption(owner.id);await page.getByLabel('Source group 88',{exact:true}).selectOption(group.id);await page.getByRole('button',{name:'Preview assignments',exact:true}).click();await page.getByText('2 ready · 0 left unmapped on this page.',{exact:true}).waitFor();await inspect('ownership-preview-'+width);
 await page.getByRole('button',{name:'Apply assignments',exact:true}).click();await page.getByText('2 assignments applied. 0 remain to review.',{exact:true}).waitFor();await inspect('ownership-applied-'+width);
 const tickets=(await request(native+'/conversations?view=all',{token})).data;assert.equal(tickets.length,2);
 for(const ticket of tickets){const stored=(await request(`${native}/conversations/${ticket.id}/ticket`,{token})).data;assert.equal(stored.assigned_to,owner.id);assert.equal(stored.group_id,group.id);assert.equal(stored.status_category,ticket.subject.endsWith('closed')?'closed':'solved')}
 }finally{const restored=await page.request.post(origin+'/api/identity/switch-project',{headers:{Origin:origin},data:{projectId:previous.projectId}});assert.equal(restored.status(),200)}
}
