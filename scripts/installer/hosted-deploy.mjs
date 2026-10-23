import {offlineDeploy} from './offline-deploy.mjs';
import {ownerDeploy} from '@runeditrun/rer/deploy';
import {missing} from '@runeditrun/rer/errors';
import {deployEnvironment} from '@runeditrun/rer/internal/cli/deploy-inputs.mjs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hostedDeclaration} from './hosted-origin.mjs';

// Use the same input precedence as rer, including a private --env-file and a
// retained real setup owner. Local trial addresses cannot receive hosted login mail.
export function hostedDeploy(path,lifecycle){
 const deploy=ownerDeploy(path,lifecycle);
 return Object.assign(async context=>{
  if(!context.options.remove&&!context.options.setSecret&&!context.options.unsetSecret){
   const declaration=JSON.parse(await readFile(join(context.root,path),'utf8'));
   const {env}=await deployEnvironment({...context,declaration,settings:lifecycle.settings});
   const email=String(env.OWNER_EMAIL||'').trim();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||/@(?:[^@]+\.)?(?:test|invalid|localhost|example)$/i.test(email)||/@(?:example\.(?:com|net|org))$/i.test(email))
    throw missing('Deploy needs a real OWNER_EMAIL that can receive sign-in mail. The local trial owner (owner@run-happytohelp.test) has no mailbox and cannot own a hosted workspace. Set OWNER_EMAIL privately in your environment or an owned 0600 --env-file, then run the same deploy command again. Nothing was deployed.');
   const custom=await hostedDeclaration(context.root,declaration,env.H2H_PUBLIC_ORIGIN);
   if(context.options.dryRun)return offlineDeploy(custom||path,lifecycle,context);
   if(custom)return ownerDeploy(custom,lifecycle)(context);
  }
  return deploy(context);
 },{declaration:deploy.declaration,managesHostedOwner:true});
}
