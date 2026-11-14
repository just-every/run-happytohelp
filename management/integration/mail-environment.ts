const nativeProviders=['resend','cloudflare','sendgrid','mailgun'];
const configured=(env:Record<string,string>,name:string)=>typeof env[name]==='string'&&env[name].trim()!=='';

/** Match native deployment's explicit-off public settings; private names remain selected separately. */
export function normalizePublicMailSettings(env:Record<string,string>):Record<string,string>{
 if(env.MAIL_MODE!=='off'&&!['off','none','disabled'].includes(env.MAIL_PROVIDER))return {...env};
 const result:Record<string,string>={...env,MAIL_MODE:'off',MAIL_PROVIDER:'none'};
 for(const name of ['EMAIL_PROVIDER','EMAIL_API_KEY_NAME','EMAIL_ACCOUNT_ID','MAILGUN_DOMAIN','MAILGUN_REGION','MAIL_FROM','MAIL_RELAY_URL','H2H_RER_MAIL_VERSION','RER_MAILBOX_ID','RER_MAIL_ADDRESS','RER_MAIL_CONTROL_URL'])delete result[name];
 return result;
}

/** Public selection only. Private bindings are selected by name and checked by the delivery broker. */
export function validatePublicMailSettings(env:Record<string,string>){
 if(configured(env,'MAIL_MODE')&&!['off','own','rer'].includes(env.MAIL_MODE))throw new Error('MAIL_MODE must be off, own or rer');
 if(env.MAIL_MODE==='off'||['off','none','disabled'].includes(env.MAIL_PROVIDER))return;
 const selection=env.MAIL_MODE==='own'?'own':env.MAIL_MODE==='rer'?'rer':env.MAIL_PROVIDER;
 if(selection==='rer'){
  for(const name of ['MAIL_FROM','MAIL_RELAY_URL','RER_MAILBOX_ID','RER_MAIL_ADDRESS','RER_MAIL_CONTROL_URL'])if(!configured(env,name))throw new Error(`Managed email requires ${name}`);
  if(env.H2H_RER_MAIL_VERSION!=='1'||env.MAIL_FROM.toLowerCase()!==env.RER_MAIL_ADDRESS.toLowerCase())throw new Error('Managed conversation mail requires version 1 and the assigned address');
  for(const name of ['MAIL_RELAY_URL','RER_MAIL_CONTROL_URL']){
   let url:URL;try{url=new URL(env[name]);}catch{throw new Error(`${name} must be a valid URL`);}
   if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error(`${name} must be HTTPS without credentials or query parameters`);
  }
  return;
 }
 if(selection?.trim()&&!['direct','own',...nativeProviders].includes(selection))throw new Error('Unsupported MAIL_PROVIDER');
 if(nativeProviders.includes(selection)&&configured(env,'EMAIL_PROVIDER')&&selection!==env.EMAIL_PROVIDER)throw new Error('Native MAIL_PROVIDER must match EMAIL_PROVIDER');
 const provider=nativeProviders.includes(selection)?selection:env.EMAIL_PROVIDER;
 if(!provider||provider==='later')return;
 if(!nativeProviders.includes(provider))throw new Error('EMAIL_PROVIDER must be resend, cloudflare, sendgrid or mailgun');
 if(provider==='cloudflare'&&!/^[a-f0-9]{32}$/i.test(env.EMAIL_ACCOUNT_ID??''))throw new Error('Cloudflare email requires a valid EMAIL_ACCOUNT_ID');
 if(provider==='mailgun'){
  if((env.EMAIL_API_KEY_NAME??'MAILGUN_SENDING_KEY')!=='MAILGUN_SENDING_KEY')throw new Error('EMAIL_API_KEY_NAME must select MAILGUN_SENDING_KEY for Mailgun');
  if(!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(env.MAILGUN_DOMAIN??''))throw new Error('Mailgun requires a valid MAILGUN_DOMAIN');
  if(!['us','eu'].includes(env.MAILGUN_REGION??'us'))throw new Error('MAILGUN_REGION must be us or eu');
 }
}
