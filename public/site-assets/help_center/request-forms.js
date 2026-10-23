(() => {
 const form=document.querySelector('#customer-request'),definition=document.querySelector('#request-definition');if(!form||!definition)return;
 const model=JSON.parse(definition.textContent),result=document.querySelector('#request-result'),key=`h2h-request:${model.projectId}:${model.id}`;
 let command=crypto.randomUUID();
 const control=f=>form.elements.namedItem(['subject','message'].includes(f.id)?f.id:`field:${f.id}`);
 const value=f=>{const el=control(f);if(f.type==='checkbox')return el.checked;if(f.type==='multiselect')return [...el.selectedOptions].map(o=>o.value);if(['number','decimal'].includes(f.type))return el.value===''?null:Number(el.value);return el.value;};
 const condition=(field,values)=>{const c=field.condition;if(!c)return true;const v=values[c.fieldId];if(c.operator==='present')return v!==undefined&&v!==null&&v!==''&&(!Array.isArray(v)||v.length>0);if(c.operator==='includes')return Array.isArray(v)&&v.includes(c.value);return c.operator==='equals'?v===c.value:v!==c.value;};
 const values=()=>{const out={};for(const f of model.fields){if(condition(f,out))out[f.id]=value(f);}return out;};
 function update(){const accepted={};for(const f of model.fields){const row=form.querySelector(`[data-field="${CSS.escape(f.id)}"]`),active=condition(f,accepted),el=control(f);row.hidden=!active;el.disabled=!active;el.required=active&&f.required&&f.type!=='checkbox';if(active)accepted[f.id]=value(f);}}
 try {const saved=JSON.parse(sessionStorage.getItem(key));if(saved&&Date.now()-saved.at<900000){command=saved.command;for(const f of model.fields){const el=control(f),v=saved.values[f.id];if(v===undefined)continue;if(f.type==='checkbox')el.checked=v;else if(f.type==='multiselect')for(const o of el.options)o.selected=v.includes(o.value);else el.value=v??'';}}}catch{}
 form.addEventListener('input',()=>{update();try{sessionStorage.setItem(key,JSON.stringify({at:Date.now(),command,values:values()}));}catch{}});update();
 form.addEventListener('submit',async event=>{
  event.preventDefault();result.replaceChildren();for(const f of model.fields){control(f).removeAttribute('aria-invalid');form.querySelector(`#${CSS.escape(`request-${f.id}-error`)}`).hidden=true;}
  const v=values(),fields=Object.fromEntries(Object.entries(v).filter(([id])=>!['subject','message'].includes(id))),button=form.querySelector('button[type=submit]');button.disabled=true;button.textContent='Sending…';
  try{
   const response=await fetch(form.action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:v.subject,message:v.message,fields,localId:command,turnstileToken:form.elements.namedItem('cf-turnstile-response')?.value,locale:model.locale,afterReading:form.dataset.afterReading||undefined})});
   const data=await response.json();if(!response.ok){
    result.textContent=data.error||'Your request could not be sent.';
    if(data.field){const f=model.fields.find(f=>f.id===data.field);if(f){const el=control(f),err=form.querySelector(`#${CSS.escape(`request-${f.id}-error`)}`);el.setAttribute('aria-invalid','true');err.textContent=data.error;err.hidden=false;el.focus();}}
    if(response.status===428){const a=document.createElement('a');a.href=form.dataset.signin;a.target='_blank';a.rel='noopener';a.textContent=' Verify your email, then return here to submit.';result.append(a);}
    if(window.turnstile)window.turnstile.reset();return;
   }
   sessionStorage.removeItem(key);const ticket=data.ticket||data;const a=document.createElement('a');a.href=`/portal/${encodeURIComponent(model.projectId)}/requests/${encodeURIComponent(ticket.id)}`;a.textContent='View your request';result.append(document.createTextNode('Your request was sent. '),a);form.hidden=true;result.focus();
  }catch {result.textContent='The connection was interrupted. Your form is still here. Submit again to check the same request.';}
  finally{button.disabled=false;button.textContent=model.submitLabel;}
 });
})();
