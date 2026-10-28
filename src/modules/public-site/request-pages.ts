import {withAccountChoices} from '../forms/account-lookup'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {listForms,readForm} from '../forms'
import type {PublicForm,PublicField} from '../forms/types'
import {resolvePortalActor} from '../portal/identity'
import {readPortalPreferences} from '../portal/preferences'
import {getKnowledgeExperience} from '../knowledge/experience'
import {resolvePublicProject} from './help-center'
import {shell} from './shell'
import {helpTemplate} from './help-template'
import {escapeHtml as e} from './html'

export const requestFormPages=new Hono<AppEnv>()
const enc=encodeURIComponent
const safeJson=(value:unknown)=>JSON.stringify(value).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026')
function input(f:PublicField,verified:boolean){
 const accountHint=f.type==='account'?`<p class="request-account-status" id="request-${e(f.id)}-account-status" role="status">${!verified?'Verify your email to see your accounts. Choices update here when you return.':!f.options.length?'No accounts are available for your verified email. Contact the support team through the website chat to check your account access.':'Choose an account you belong to.'}</p>`:''
 const name=['subject','message'].includes(f.id)?f.id:`field:${f.id}`,id=`request-${f.id}`,required=f.required?' required':'',hint=f.type==='account'?` aria-describedby="${e(id)}-account-status${f.description?' '+e(id)+'-hint':''}"`:f.description?` aria-describedby="${e(id)}-hint"`:''
 let control=''
 if(f.type==='dropdown'||f.type==='multiselect'||f.type==='account')control=`<select id="${e(id)}" name="${e(name)}"${f.type==='multiselect'?' multiple':''}${required}${hint}>${f.type!=='multiselect'?'<option value="">Choose an option</option>':''}${f.options.map(o=>`<option value="${e(o.value)}">${e(o.label)}</option>`).join('')}</select>`
 else if(f.id==='message')control=`<textarea id="${e(id)}" name="${e(name)}" rows="7" maxlength="100000"${required}${hint}></textarea>`
 else if(f.type==='checkbox')control=`<input id="${e(id)}" name="${e(name)}" type="checkbox"${hint}>`
 else control=`<input id="${e(id)}" name="${e(name)}" type="${['number','decimal'].includes(f.type)?'number':f.type==='date'?'date':'text'}"${f.type==='decimal'?' step="any"':''}${f.type==='number'?' step="1"':''}${['text','regex'].includes(f.type)?` maxlength="${f.validation.max??4000}"`:''}${required}${hint}>`
 return `<div class="request-field" data-field="${e(f.id)}"><label for="${e(id)}">${e(f.label)}${f.required?' <span class="request-required">(required)</span>':''}</label>${control}${accountHint}${f.description?`<p id="${e(id)}-hint">${e(f.description)}</p>`:''}<p class="request-field-error" id="${e(id)}-error" hidden></p></div>`
}
async function render(c:any){
 const key=c.req.param('project'),project=await resolvePublicProject(c.env,key)
 if(!project)throw new HTTPException(404)
 c.header('Cache-Control','private, no-store');c.header('Vary','Cookie, Authorization');c.header('X-Robots-Tag','noindex, nofollow');c.header('Referrer-Policy','same-origin')
 c.header('Content-Security-Policy',"default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; form-action 'self'; frame-ancestors 'self'; base-uri 'self'")
 const identity=await resolvePortalActor(c.env,project.id,c.req.raw)
 const portal=c.req.path.startsWith('/portal/'),base=`/help/${enc(key)}`,locale=c.req.query('locale')||(identity?(await readPortalPreferences(c.env,identity)).locale:undefined),forms=await listForms(c.env,project.id,locale)
 const read=c.req.query('read'),readQuery=typeof read==='string'&&/^[a-f0-9-]{72}$/.test(read)?read:undefined
 const selected=c.req.param('formId')||c.req.query('form'),selectedForm=selected?await readForm(c.env,project.id,selected,locale):forms.length===1?forms[0]:null,form=selectedForm?await withAccountChoices(c.env,selectedForm,identity):null
 const formBase=portal?`/portal/${enc(key)}/requests/new`:`${base}/requests`,link=(id:string)=>portal?`${formBase}?${new URLSearchParams({form:id,...(locale?{locale}:{}),...(readQuery?{read:readQuery}:{})})}`:`${formBase}/${enc(id)}${locale||readQuery?'?'+new URLSearchParams({...locale?{locale}:{},...readQuery?{read:readQuery}:{}}):''}`
 const tools=`<nav class="help-center-controls" aria-label="Customer support"><a href="${base}">Help Center</a><a href="/portal/${enc(key)}/requests">My requests</a><a href="/portal/${enc(key)}/preferences">Notification preferences</a></nav>`
 let content=`<h1>Submit a request</h1><p>Choose the form that fits your question. Our support team will reply to your verified email address.</p>`
 if(!forms.length)content+='<p>No request forms are published yet. Please contact the team through the website chat.</p>'
 else if(!form)content+=`<ul class="request-form-list">${forms.map(f=>`<li><h2><a href="${link(f.id)}">${e(f.title)}</a></h2><p>${e(f.description)}</p></li>`).join('')}</ul>`
 else{
  const returnTo=c.req.path+(c.req.url.includes('?')?'?'+new URL(c.req.url).searchParams.toString():''),signin=`/portal/${enc(key)}?returnTo=${enc(returnTo)}`
  const language=form.locales.length>1?`<form method="get" class="help-center-language"><label for="request-locale">Language</label>${portal?`<input name="form" type="hidden" value="${e(form.id)}">`:''}${readQuery?`<input name="read" type="hidden" value="${e(readQuery)}">`:''}<select id="request-locale" name="locale">${form.locales.map(l=>`<option value="${e(l)}"${l===form.locale?' selected':''}>${e(new Intl.DisplayNames([form.locale],{type:'language'}).of(l)||l)}</option>`).join('')}</select><button>Apply</button></form>`:''
  content=`${forms.length>1?`<p><a class="request-choose-form" href="${formBase}">Choose another form</a></p>`:''}${language}<h1>${e(form.title)}</h1><p>${e(form.description)}</p><div id="request-result" role="status" tabindex="-1"></div><form id="customer-request" class="customer-request" action="/api/forms/${enc(project.id)}/${enc(form.id)}/submissions" method="post" data-signin="${e(signin)}" data-verified="${identity?'1':'0'}">${!identity?`<p class="request-identity">Before we send your request, you’ll need to <a href="${e(signin)}" target="_blank" rel="noopener">verify your email</a>. Keep this form open while you sign in.</p>`:`<p class="request-identity">You’re signed in. Your request will appear in <a href="/portal/${enc(key)}/requests">My requests</a>.</p>`}${readQuery?`<p>This request will be counted as following an article read.</p><input type="hidden" name="knowledgeRead" value="${e(readQuery)}">`:''}${form.fields.map(field=>input(field,!!identity)).join('')}${!identity?(form.turnstileSiteKey?`<div class="cf-turnstile" data-sitekey="${e(form.turnstileSiteKey)}" data-action="request_form"></div>`:'<p class="request-unavailable">Anonymous requests require spam protection. Ask the support team to configure it, or sign in to submit your request.</p>'):''}<button type="submit">${e(form.submitLabel)}</button><noscript><p>Enable JavaScript to use the conditional fields and submit this form.</p></noscript></form><script type="application/json" id="request-definition">${safeJson(form)}</script><script src="/site-assets/help_center/request-forms.js" defer></script>${!identity&&form.turnstileSiteKey?'<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>':''}`
  const experience=await getKnowledgeExperience(c.env,project.id);content=helpTemplate(experience.templates.request,content,form.title,form.description)
 }
 return c.html(shell(project,base,content,{search:false,noindex:true,title:`${form?.title||'Submit a request'} · ${project.name}`,locale:form?.locale||locale||'en',tools}).replace('</head>','<link rel="stylesheet" href="/site-assets/help_center/request-forms.css"></head>'))
}
requestFormPages.get('/help/:project/requests',render)
requestFormPages.get('/help/:project/requests/:formId',render)
requestFormPages.get('/portal/:project/requests/new',render)
