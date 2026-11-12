import {nativeMailgunDeploy} from './native-mailgun-deploy.mjs';
import {transitionMailBindings} from './mail-transition.mjs';
import {offlineDeploy} from './offline-deploy.mjs';
import {managedDeployPath} from '../deployment/mail-declaration.mjs';
import {ownerDeploy} from '@runeditrun/rer/deploy';
import {missing} from '@runeditrun/rer/errors';
import {deployEnvironment} from '@runeditrun/rer/internal/cli/deploy-inputs.mjs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hostedDeclaration} from './hosted-origin.mjs';
import {deploymentMailEnvironment,mailInputNames,outboundEmailOff,validateRuntimeEnvironment} from '../deployment/environment.mjs';

// Rer prints only its own errors, since another message may quote a private value.
// These deployment checks name the input, never its value, so the owner sees it.
const refusal=check=>{try{return check();}catch(error){throw error?.constructor===Error?Object.assign(missing(`${error.message}. Nothing was built or uploaded.`),{names:error.message.match(/\b[A-Z][A-Z0-9_]+\b/g)??[]}):error;}};

// Use the same input precedence as rer, including a private --env-file and a
// retained real setup owner. Local trial addresses cannot receive hosted login mail.
export function hostedDeploy(path,lifecycle){
 const deploy=ownerDeploy(path,lifecycle);
 return Object.defineProperty(Object.assign(async context=>{
  if(context.options.setSecret){
   const declaration=JSON.parse(await readFile(join(context.root,path),'utf8'));
   const {env}=await deployEnvironment({...context,declaration,settings:lifecycle.settings});
   const requested=String(context.options.setSecret).split(',');
   if(requested.some(name=>mailInputNames.includes(name)||declaration.secrets?.some(item=>item.binding===name&&mailInputNames.includes(item.environment)))&&(!env.MAIL_MODE&&!env.MAIL_PROVIDER||outboundEmailOff(env)))throw missing('Mail credentials are not bound while email is off. Save them privately, then explicitly choose MAIL_MODE=own and EMAIL_PROVIDER before deploying.');
  }
  if(!context.options.remove&&!context.options.setSecret&&!context.options.unsetSecret){
   const declaration=JSON.parse(await readFile(join(context.root,path),'utf8'));
   // Resolve private inputs without generating keys ahead of ownerDeploy's
   // custody tracking. The surrounding rer withDeployEnvironment restores the
   // command environment after both deployment and its final dry-run report.
   const setupManifest=context.setupManifest?{...context.setupManifest,fields:[]}:undefined;
   const {env:inputs}=await deployEnvironment({...context,setupManifest,declaration,settings:lifecycle.settings});
   const env=refusal(()=>deploymentMailEnvironment(inputs));
   // MAIL_PROVIDER=none is the deploy's explicit choice to bind nothing that can send.
   // Owners then sign in with scripts/hosted-signin.mjs, declared as mailOffSignIn.
   const off=outboundEmailOff(env);
   // Native credentials must be real inputs, never the managed key generator's
   // output. Managed generated keys are resolved later by ownerDeploy. A dry run
   // goes ahead without them and lists what a real deploy needs.
   if(env.MAIL_PROVIDER!=='rer'&&!context.options.dryRun)refusal(()=>validateRuntimeEnvironment(inputs));
   const email=String(env.OWNER_EMAIL||'').trim();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||/@(?:[^@]+\.)?(?:test|invalid|localhost|example)$/i.test(email)||/@(?:example\.(?:com|net|org))$/i.test(email))
    throw missing(`Deploy needs a real OWNER_EMAIL${off?', the owner this installation is claimed for':' that can receive sign-in mail'}. The local trial owner (owner@run-happytohelp.test) has no mailbox and cannot own a hosted workspace. Set OWNER_EMAIL privately in your environment or an owned 0600 --env-file, then run the same deploy command again. Nothing was deployed.`);
   if(env.MAIL_PROVIDER!=='rer'&&!off&&!context.options.dryRun&&!env.EMAIL_PROVIDER?.trim())throw missing('Production sign-in needs native outbound email: EMAIL_PROVIDER (resend, sendgrid, cloudflare or mailgun), EMAIL_FROM, EMAIL_API_KEY. Cloudflare also requires EMAIL_ACCOUNT_ID. Set these privately in your environment or an owned 0600 --env-file, then run the same deploy command again. Nothing was built or uploaded.');
   // Rer already validated and imported the private file. Consume those resolved
   // inputs once so rereading it cannot put the setup discriminator `direct`
   // back over the actual provider during preflight or the final report.
   Object.assign(process.env,env);
   for(const name of Object.keys(inputs))if(!(name in env))delete process.env[name];
   if(env.MAIL_PROVIDER===undefined)delete process.env.MAIL_PROVIDER;
   context.options.envFile=undefined;
   // Keep the explicit off switch in the upload; saving credentials alone cannot enable mail.
   const custom=await hostedDeclaration(context.root,declaration,env.H2H_PUBLIC_ORIGIN,env);
   if(context.options.dryRun)return offlineDeploy(custom||path,lifecycle,context);
   await transitionMailBindings(context,declaration,env);
   if(env.EMAIL_PROVIDER==='mailgun'&&!off&&env.MAIL_PROVIDER!=='rer')return nativeMailgunDeploy(custom||path,lifecycle,context);
   if(custom)return ownerDeploy(custom,lifecycle)(context);
  }
  return deploy(context);
 },{managesHostedOwner:true}),'declaration',{get:()=>process.env.MAIL_PROVIDER==='rer'?managedDeployPath:deploy.declaration});
}
