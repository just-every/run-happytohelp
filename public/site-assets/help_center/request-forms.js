(() => {
 const form=document.querySelector('#customer-request'),definition=document.querySelector('#request-definition');if(!form||!definition)return;
 const model=JSON.parse(definition.textContent),result=document.querySelector('#request-result'),key=`h2h-request:${model.projectId}:${model.id}`;
 let command=crypto.randomUUID();
 const control=f=>form.elements.namedItem(['subject','message'].includes(f.id)?f.id:`field:${f.id}`);
 const value=f=>{const el=control(f);if(f.type==='checkbox')return el.checked;if(f.type==='multiselect')return [...el.selectedOptions].map(o=>o.value);if(['number','decimal'].includes(f.type))return el.value===''?null:Number(el.value);return el.value;};
 const condition=(field,values)=>{if(field.visible!==undefined)return field.visible;const c=field.condition;if(!c)return true;const v=values[c.fieldId];if(c.operator==='present')return v!==undefined&&v!==null&&v!==''&&(!Array.isArray(v)||v.length>0);if(c.operator==='includes')return Array.isArray(v)&&v.includes(c.value);return c.operator==='equals'?v===c.value:v!==c.value;};
 const values=()=>{const out={};for(const f of model.fields){if(condition(f,out))out[f.id]=value(f);}return out;};
 function update(){const accepted={};for(const f of model.fields){const row=form.querySelector(`[data-field="${CSS.escape(f.id)}"]`),active=condition(f,accepted),el=control(f);row.hidden=!active;el.disabled=!active||(f.type==='account'&&!f.options.length&&el.getAttribute('aria-invalid')!=='true');el.required=active&&f.required&&f.type!=='checkbox'&&(f.type!=='account'||f.options.length>0);if(active)accepted[f.id]=value(f);}
 const blocked=model.fields.some(f=>f.type==='account'&&f.required&&!f.options.length&&!form.querySelector(`[data-field="${CSS.escape(f.id)}"]`).hidden);form.querySelector('button[type=submit]').disabled=blocked;}
 try {const saved=JSON.parse(sessionStorage.getItem(key));if(saved&&Date.now()-saved.at<900000){command=saved.command;for(const f of model.fields){const el=control(f),v=saved.values[f.id];if(v===undefined)continue;if(f.type==='checkbox')el.checked=v;else if(f.type==='multiselect')for(const o of el.options)o.selected=v.includes(o.value);else el.value=v??'';}}}catch{}
 form.addEventListener('input',()=>{update();try{sessionStorage.setItem(key,JSON.stringify({at:Date.now(),command,values:values()}));}catch{}});update();
 let refreshing,refreshAgain=false;
 async function refreshAccounts(){
  if(form.hidden)return;
  if(refreshing){refreshAgain=true;return refreshing;}
  refreshing=(async()=>{
   try{
    const response=await fetch(`/api/forms/${encodeURIComponent(model.projectId)}/${encodeURIComponent(model.id)}?${new URLSearchParams({locale:model.locale,fields:JSON.stringify(Object.fromEntries(Object.entries(values()).filter(([id])=>model.fields.some(f=>f.id===id&&f.type==='account'))))})}`,{cache:'no-store'});
    if(!response.ok&&![401,403,404].includes(response.status))return;
    const {data}=response.ok?await response.json():{data:{verified:false,fields:[]}};
    for(const field of model.fields){const current=data.fields.find(f=>f.id===field.id);delete field.condition;delete field.visible;if(current?.condition)field.condition=current.condition;if(current?.visible!==undefined)field.visible=current.visible;else if(!current)field.visible=false;}
    model.verified=data.verified;form.dataset.verified=data.verified?'1':'0';
    for(const field of model.fields.filter(f=>f.type==='account')){
     const current=data.fields.find(f=>f.id===field.id),el=control(field),selected=el.value;
     field.options=current?.options||[];
     el.replaceChildren(new Option('Choose an account',''),...field.options.map(o=>new Option(o.label,o.value)));
     el.value=field.options.some(o=>o.value===selected)?selected:'';
     const hint=form.querySelector(`#${CSS.escape(`request-${field.id}-account-status`)}`);
     hint.textContent=!current?'This account question has changed. Contact the support team through the website chat.':!data.verified?'Verify your email to see your accounts. Choices update here when you return.':!field.options.length?'No accounts are available for your verified email. Contact the support team through the website chat to check your account access.':'Choose an account you belong to.';
    }
    if(data.verified){
     const identity=form.querySelector('.request-identity');identity.replaceChildren(document.createTextNode('You’re signed in. Your request will appear in '));
     const link=document.createElement('a');link.href=`/portal/${encodeURIComponent(model.projectId)}/requests`;link.textContent='My requests';identity.append(link,document.createTextNode('.'));
     form.querySelector('.request-unavailable')?.remove();
    }else{
     const identity=form.querySelector('.request-identity'),link=document.createElement('a');link.href=form.dataset.signin;link.target='_blank';link.rel='noopener';link.textContent='verify your email';identity.replaceChildren(document.createTextNode('Before we send your request, '),link,document.createTextNode('. Keep this form open while you sign in.'));
    }
    update();
   }catch{}finally{refreshing=null;if(refreshAgain){refreshAgain=false;await refreshAccounts();}}
  })();return refreshing;
 }
 if(model.fields.some(f=>f.type==='account')){
  form.addEventListener('change',event=>{if(model.fields.some(f=>control(f)===event.target))refreshAccounts();});
  window.addEventListener('focus',refreshAccounts);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAccounts();});
  setInterval(()=>{if(!document.hidden)refreshAccounts();},15000);
  refreshAccounts();
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();result.replaceChildren();for(const f of model.fields){control(f).removeAttribute('aria-invalid');form.querySelector(`#${CSS.escape(`request-${f.id}-error`)}`).hidden=true;}
  const v=values(),fields=Object.fromEntries(Object.entries(v).filter(([id])=>!['subject','message'].includes(id))),button=form.querySelector('button[type=submit]');button.disabled=true;button.textContent='Sending…';
  try{
   const response=await fetch(form.action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:v.subject,message:v.message,fields,localId:command,turnstileToken:form.elements.namedItem('cf-turnstile-response')?.value,locale:model.locale})});
   const data=await response.json();if(!response.ok){
    result.textContent=data.error||'Your request could not be sent.';
    if(data.field){const f=model.fields.find(f=>f.id===data.field);if(f){const el=control(f),err=form.querySelector(`#${CSS.escape(`request-${f.id}-error`)}`);if(f.type==='account'&&data.code==='invalid_account')el.value='';el.setAttribute('aria-invalid','true');err.textContent=data.error;err.hidden=false;update();el.focus();}}
    if(response.status===428){const a=document.createElement('a');a.href=form.dataset.signin;a.target='_blank';a.rel='noopener';a.textContent=' Verify your email, then return here to submit.';result.append(a);}
    await refreshAccounts();if(!form.contains(document.activeElement)||document.activeElement.disabled||document.activeElement.closest('[hidden]'))result.focus();if(window.turnstile)window.turnstile.reset();return;
   }
   sessionStorage.removeItem(key);const ticket=data.ticket||data;const a=document.createElement('a');a.href=`/portal/${encodeURIComponent(model.projectId)}/requests/${encodeURIComponent(ticket.id)}`;a.textContent='View your request';result.append(document.createTextNode('Your request was sent. '),a);form.hidden=true;result.focus();
  }catch {result.textContent='The connection was interrupted. Your form is still here. Submit again to check the same request.';}
  finally{button.textContent=model.submitLabel;update();}
 });
})();
