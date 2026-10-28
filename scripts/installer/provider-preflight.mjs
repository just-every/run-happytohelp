import {cloudflare} from '@runeditrun/rer/modules/deploy-kit/provider';
import {PreflightRefusal} from './preflight-inputs.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clean=(value,credentials)=>{
 let text=String(value);
 for(const secret of Object.values(credentials).flatMap(value=>[value,encodeURIComponent(value),JSON.stringify(value).slice(1,-1)]).sort((a,b)=>b.length-a.length))
  text=text.split(secret).join('[REDACTED]');
 return text.replace(/[\x00-\x1f\x7f-\x9f]+/g,' ').replace(/https?:\/\/\S+/gi,'[URL omitted]').slice(0,900);
};

/** These are the three ownerDeploy reads, independently started; never a build,
 * deployment, mail check, health request or resource discovery. */
export async function providerPreflight(credentials,worker,report){
 let requests=0;
 const read=async path=>{
  requests++;report('preflight: GET '+path);
  // One request per client disables even transport retries. Use the envelope
  // directly: this inspection never follows list pagination or redirects.
  return (await cloudflare({...credentials,maxRequests:1}).envelope(path,{method:'GET'})).result;
 };
 try{
  const account=await read('/workers/subdomain');
  if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(account?.subdomain??''))throw new PreflightRefusal('Cloudflare returned an invalid Workers subdomain.');
  report('preflight: Workers subdomain: '+clean(account.subdomain,credentials)+'.workers.dev');
  let settings;
  try{settings=await read('/workers/scripts/'+worker+'/settings');}
  catch(error){
   if(error.status!==404)throw error;
   report('preflight: Worker '+worker+' is not deployed (HTTP 404). Secret names were not requested.');
   return;
  }
  if(!object(settings)||!Array.isArray(settings.bindings))throw new PreflightRefusal('Cloudflare returned invalid Worker settings.');
  const secrets=await read('/workers/scripts/'+worker+'/secrets');
  if(!Array.isArray(secrets)||!secrets.every(item=>object(item)&&typeof item.name==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(item.name)))
   throw new PreflightRefusal('Cloudflare returned invalid secret names.');
  // Allowlisted summary only. Binding values, metadata, arbitrary provider
  // fields and secret contents never enter a report, receipt or local file.
  const date=/^\d{4}-\d{2}-\d{2}$/.test(settings.compatibility_date??'')?settings.compatibility_date:'not reported';
  report('preflight: Worker '+worker+' settings: compatibility date '+date+'; '+settings.bindings.length+' bindings; '+(Array.isArray(settings.compatibility_flags)?settings.compatibility_flags.length:0)+' compatibility flags.');
  report('preflight: Secret names: '+(secrets.map(item=>clean(item.name,credentials)).sort().join(', ')||'(none)')+'.');
 }catch(error){
  if(error instanceof PreflightRefusal)throw error;
  const status=Number.isInteger(error.status)?'HTTP '+error.status:'no HTTP status';
  const messages=error.providerRefusal?.errors?.map(item=>[Number.isInteger(item.code)?item.code:undefined,item.message].filter(value=>value!==undefined).join(' ')).join('; ');
  throw new PreflightRefusal('Cloudflare preflight failed ('+status+'): '+(messages?clean(messages,credentials):'provider response or transport could not be read')+'. No retry was made.');
 }finally{
  report('preflight: '+requests+' GET request'+(requests===1?'':'s')+' attempted; no mail or resource changes.');
 }
}
