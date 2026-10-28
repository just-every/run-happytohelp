import assert from 'node:assert/strict'

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1cAAAAASUVORK5CYII=','base64')

// Continue the owner's configured workspace through appearance and artwork,
// checking the same saved brand at the public widget boundary.
export async function workspaceBrand(app){
 const base='/api/management/projects/p',token='token',operator='operator-token'
 const foreign=(await app.seedWorkspace('brand-foreign')).tokens.owner
 const put=body=>app.call(base+'/settings',{token,method:'PUT',body})
 const settings=async()=>(await app.ok(base+'/settings',{token})).data
 const origin=(await settings()).allowed_origin
 const brand=async()=>(await app.ok('/api/widget/settings?widgetKey=widget',{headers:{Origin:origin}})).brand
 assert.equal((await put({brand_name:'Northstar 顧客',welcome_message:'How can we help?\nAsk about your order.',primary_color:'#236d78',logo_url:'https://images.example/logo.png'})).status,200)
 const saved=await settings(),publicBrand=await brand()
 assert.ok(JSON.stringify(publicBrand).includes('Northstar 顧客'))
 assert.ok(JSON.stringify(publicBrand).includes('#236d78'))
 assert.ok(JSON.stringify(publicBrand).includes('Ask about your order.'))
 assert.equal((await put({brand_name:'Must not save',logo_url:'javascript:alert(1)'})).status,400)
 assert.deepEqual(await settings(),saved,'invalid updates preserve the whole saved brand')
 assert.equal((await app.call(base+'/settings',{token:operator,method:'PUT',body:{brand_name:'Denied'}})).status,403)
 assert.equal((await app.call(base+'/settings',{token:foreign,method:'PUT',body:{brand_name:'Foreign'}})).status,403)
 await app.ok(base+'/settings',{token,method:'PUT',body:{logo_url:'',brand_name:''}})
 assert.equal((await settings()).logo_url,'');assert.equal((await settings()).brand_name,'')
 await app.ok(base+'/settings',{token,method:'PUT',body:{brand_name:saved.brand_name,logo_url:saved.logo_url}})
 const appearance=(await app.ok(base+'/appearance',{token})).data
 const {website,name,primaryColor}=appearance
 const headers={'Content-Type':'image/png','x-h2h-expected-workspace':encodeURIComponent(JSON.stringify({website,name,primaryColor})),'x-h2h-expected-artwork':'none'}
 assert.equal((await app.call(base+'/artwork',{token:operator,method:'PUT',raw:true,headers,body:png})).status,403)
 assert.equal((await app.call(base+'/artwork',{token:foreign,method:'PUT',raw:true,headers,body:png})).status,403)
 const staleHeaders={...headers,'x-h2h-expected-workspace':encodeURIComponent(JSON.stringify({website,name:'Previous workspace name',primaryColor}))}
 assert.equal((await app.call(base+'/artwork',{token,method:'PUT',raw:true,headers:staleHeaders,body:png})).status,409)
 const contenders=await Promise.all([1,2].map(()=>app.call(base+'/artwork',{token,method:'PUT',raw:true,headers,body:png})))
 assert.deepEqual(contenders.map(result=>result.status).sort(),[200,409],'concurrent creation has one winner')
 const image=contenders.find(result=>result.status===200).data.data.artwork_url
 assert.ok(image)
 assert.deepEqual(Buffer.from(await (await app.request(image,{token:operator})).arrayBuffer()),png)
 assert.equal((await app.call(image)).status,401)
 assert.ok([403,404].includes((await app.call(image,{token:foreign})).status))
 const bootstrap=await app.ok('/api/management/bootstrap',{token:operator})
 assert.equal(bootstrap.projects.p.sidebar_artwork_url,image)
 assert.equal(bootstrap.projects.p.sidebar_artwork_enabled,true)
 const files=()=>app.files.then(bucket=>bucket.list({prefix:'workspace-artwork/p/'}))
 const before=(await files()).objects.map(o=>o.key)
 assert.equal((await app.call(base+'/artwork',{token,method:'PUT',raw:true,headers,body:png})).status,409)
 assert.deepEqual((await files()).objects.map(o=>o.key),before,'stale artwork replacement leaves no extra object')
 const invalid=await app.call(base+'/artwork',{token,method:'PUT',raw:true,headers:{'Content-Type':'image/png'},body:Buffer.from('Invalid image')})
 assert.equal(invalid.status,400);assert.deepEqual((await files()).objects.map(o=>o.key),before)
 const replaced=await app.ok(base+'/artwork',{token,method:'PUT',raw:true,headers:{'Content-Type':'image/png'},body:png})
 const replacement=replaced.data.artwork_url
 assert.notEqual(replacement,image);assert.equal((await app.call(image,{token})).status,404)
 assert.equal((await files()).objects.length,1,'the old image and concurrent loser leave no orphan bytes')
 await app.ok(base+'/appearance',{token,method:'PUT',body:{artwork_enabled:false}})
 assert.equal((await app.ok(base+'/appearance',{token})).data.artwork_enabled,false)
 assert.equal((await files()).objects.length,1,'disabling artwork retains the saved image for the workspace')
 // Last-owner and empty-contact refusals belong to the same workspace lifecycle.
 assert.equal((await app.call(base+'/agents/u',{token,method:'DELETE'})).status,409)
 assert.equal((await app.call(base+'/contacts',{token,body:{name:' ',email:'',external_id:''}})).status,400)
}
