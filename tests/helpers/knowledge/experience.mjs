import assert from 'node:assert/strict'
import {knowledgeApp} from './app.mjs'
export async function experienceJourney(){
const k=await knowledgeApp({bindings:{APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'fixture-key',EMAIL_FROM:'support@example.test',INBOUND_EMAIL_TOKEN:'fixture-native-knowledge'}}),{app,p,call}=k
try{
 const mail=[];k.provider=async (request,entry)=>{assert.equal(new URL(request.url).host,'api.resend.com');mail.push(JSON.parse(entry.body));return Response.json({id:'mail-'+mail.length})}
 const category=(await call(`/api/knowledge/${p}/categories`,{body:{title:'Members',audience:'domains',allowedDomains:['trusted.test']},status:201})).data.id
 const aid=(await call(`/api/knowledge/${p}/articles`,{body:{title:'Secret',content:'Restricted instructions',slug:'secret',categoryIds:[category],status:'published'},status:201})).data.id
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/secret`)).status,404)
 assert.equal((await k.search('Restricted')).length,0)
 const openCategory=(await call(`/api/knowledge/${p}/categories`,{body:{title:'Public'},status:201})).data.id
 const child=(await call(`/api/knowledge/${p}/categories`,{body:{title:'Child',parentId:category},status:201})).data.id
 const nested=(await call(`/api/knowledge/${p}/articles`,{body:{title:'Nested secret',slug:'nested-secret',content:'Restricted hierarchy',categoryIds:[openCategory,child],status:'published'},status:201})).data.id
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/nested-secret`)).status,404,'public second collection cannot bypass a restricted ancestor')
 assert.ok(!(await app.call(`/api/knowledge/public/${p}/categories`,{status:200})).data.some(c=>c.id===child))
 assert.equal((await call(`/api/knowledge/${p}/categories/${category}`,{method:'DELETE'})).status,409,'deletion cannot silently make descendants public')
 assert.equal((await call(`/api/knowledge/${k.other}/articles/${aid}/history`)).status,403)
 await app.db.prepare("INSERT INTO email_settings VALUES(?,'Support','support@example.test','native-help@example.test',1,1)").bind(p).run()
 const received=(await app.call('/api/integrations/email/inbound',{headers:{Authorization:'Bearer fixture-native-knowledge'},body:{messageId:'native-knowledge@example.test',to:'native-help@example.test',from:'native@trusted.test',subject:'Account question',text:'Please explain my business account.'},status:201})).data
 const emailConversation=received.conversationId||received.conversation_id
 assert.ok((await call(`/api/knowledge/${p}/conversations/${emailConversation}/articles`,{status:200})).data.some(a=>a.id===aid),'a proven native email customer can receive their permitted article')


 const signed=await app.first('SELECT verification_secret FROM projects WHERE id=?',p)
 const {createHmac}=await import('node:crypto')
 const widget=async(identifier,email)=>{const contact_hash=createHmac('sha256',signed.verification_secret).update(identifier).digest('hex');return (await app.call('/api/identity/widget/session',{body:{widgetKey:'widget-p',identifier,email,contact_hash},status:201})).data}
 const good=await widget('customer@trusted.test','customer@trusted.test')
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/secret`,{token:good.token})).status,200)
 const bad=await widget('customer-id','customer@trusted.test')
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/secret`,{token:bad.token})).status,404)
 const typed=(await app.call('/api/identity/widget/session',{body:{widgetKey:'widget-p',email:'reader@trusted.test'},status:201})).data
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/secret`,{token:typed.token})).status,404)
 await app.call(`/api/knowledge/public/${p}/access/request`,{body:{email:'reader@trusted.test'},status:202})
 const link=new URL(mail.at(-1).text.match(/https:\/\/[^\s]+/)[0]),verify=await app.call(link.pathname+link.search,{status:303}),cookie=verify.headers.get('Set-Cookie').split(';')[0]
 assert.ok(cookie.startsWith('h2h_help='));assert.equal((await app.call(link.pathname+link.search)).status,400,'a possession link is single-use')
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/secret`,{headers:{Cookie:cookie},status:200})).data.content,'Restricted instructions')
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/secret`,{token:typed.token})).status,404,'another contact typing the same email never gains that email-link session')
 await app.call(`/api/knowledge/public/${p}/access/logout`,{headers:{Cookie:cookie},body:{},status:200})
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/secret`,{headers:{Cookie:cookie}})).status,404)
 const goodConversation=(await app.call('/api/conversations',{token:good.token,body:{projectId:p},status:201})).data.id
 const badConversation=(await app.call('/api/conversations',{token:bad.token,body:{projectId:p},status:201})).data.id
 assert.ok((await call(`/api/knowledge/${p}/conversations/${goodConversation}/articles?q=Restricted`,{status:200})).data.some(a=>a.id===aid))
 assert.ok(!(await call(`/api/knowledge/${p}/conversations/${badConversation}/articles?q=Restricted`,{status:200})).data.some(a=>a.id===aid))
 const inserted=(await call(`/api/knowledge/${p}/conversations/${goodConversation}/articles/${aid}/insert`,{body:{mode:'text'},status:200})).data
 assert.equal(inserted.text,'Restricted instructions')
 assert.equal((await call(`/api/knowledge/${p}/conversations/${badConversation}/articles/${aid}/insert`,{body:{mode:'text'}})).status,404)

 await call(`/api/knowledge/${p}/experience`,{method:'PUT',body:{defaultLocale:'en',locales:['en','fr'],templates:{article:'{{title}}\n{{content}}'}},status:200})
 assert.equal((await call(`/api/knowledge/${p}/experience`,{status:200})).data.templates.article,'{{title}}\n{{content}}')
 await call(`/api/knowledge/${p}/articles/${aid}/translations/fr`,{method:'PUT',body:{title:'Secret FR',content:'Reviewed French',summary:'',reviewStatus:'reviewed'},status:200})
 let article=await app.call(`/api/knowledge/public/${p}/articles/secret?locale=fr`,{token:good.token,status:200});assert.equal(article.data.content,'Reviewed French')
 await call(`/api/knowledge/${p}/articles/${aid}/translations/fr`,{method:'PUT',body:{title:'Draft FR',content:'Unreviewed French',reviewStatus:'draft'},status:200})
 article=await app.call(`/api/knowledge/public/${p}/articles/secret?locale=fr`,{token:good.token,status:200});assert.equal(article.data.content,'Reviewed French')
 await call(`/api/knowledge/${p}/articles`,{body:{id:aid,title:'Secret edited',content:'New instructions',slug:'secret-new',categoryIds:[category],status:'published'},status:201})
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/secret`,{token:good.token,status:200})).data.redirectSlug,'secret-new')
 assert.equal((await call(`/api/knowledge/${p}/articles`,{body:{title:'Steal redirect',content:'No',slug:'secret',status:'published'}})).status,409)
 const history=(await call(`/api/knowledge/${p}/articles/${aid}/history`,{status:200})).data
 assert.ok(history.versions.length>=2);assert.equal(history.redirects[0].slug,'secret')
 await call(`/api/knowledge/${p}/articles/${aid}/rollback`,{body:{versionId:history.versions.at(-1).id},status:200})
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/secret`,{token:good.token,status:200})).data.content,'Restricted instructions')
 for(let n=0;n<2;n++)await app.call(`/api/knowledge/public/${p}/articles/secret/helpful`,{token:good.token,body:{helpful:true,comment:'Worked'},status:200})
 for(const kind of ['view','click'])await app.call(`/api/knowledge/public/${p}/events`,{token:good.token,body:{kind,slug:'secret',locale:'fr',query:kind==='click'?'Restricted':''},status:200})
 await app.call(`/api/knowledge/public/${p}/search?q=Restricted&locale=fr`,{token:good.token,status:200})
 await app.call(`/api/knowledge/public/${p}/search?q=absent&locale=fr`,{token:good.token,status:200})
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/secret/helpful`,{token:good.token,headers:{Origin:'https://evil.test'},body:{helpful:true}})).status,403)
 const stats=(await call(`/api/knowledge/${p}/analytics`,{status:200})).data;assert.equal(stats.totals.helpful,1);assert.equal(stats.comments[0].comment,'Worked');assert.equal(stats.totals.views,1);assert.equal(stats.totals.clicks,1);assert.ok(stats.searches.some(row=>row.query==='Restricted'&&row.withResults>0&&row.clicks===1));assert.ok(stats.searches.some(row=>row.query==='absent'&&row.withoutResults>0))
 assert.equal((await k.search('Restricted')).length,0,'private articles remain excluded from AI even after human access')

 // A content-only update through the native door must retain the current private collections.
 await call(`/api/knowledge/${p}/articles`,{body:{id:aid,title:'Secret refreshed',content:'Restricted refresh marker',slug:'secret',status:'published'},status:201})
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/secret`)).status,404)
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/secret`,{token:bad.token})).status,404)
 const refreshed=(await app.call(`/api/knowledge/public/${p}/articles/secret?locale=fr`,{token:good.token,status:200})).data
 assert.equal(refreshed.content,'Restricted refresh marker')
 assert.equal(refreshed.locale,'en');assert.equal(refreshed.requestedLocale,'fr','stale translation falls back with the requested locale disclosed')
 assert.equal((await k.search('Restricted refresh marker')).length,0)
 assert.ok((await call(`/api/knowledge/${p}/conversations/${goodConversation}/articles`,{status:200})).data.some(a=>a.id===aid))
 assert.ok(!(await call(`/api/knowledge/${p}/conversations/${badConversation}/articles`,{status:200})).data.some(a=>a.id===aid))

}finally{await k.close()}
}
