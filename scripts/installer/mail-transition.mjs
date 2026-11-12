import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {main as ownerCommand} from '@runeditrun/rer/internal/modules/deploy-kit/owner-cli.mjs';
import {missing} from '@runeditrun/rer/errors';
import {selectedMailDeclaration} from '../deployment/mail-declaration.mjs';
import {mailInputNames,outboundEmailOff} from '../deployment/environment.mjs';

/** Rer retains opaque Worker secrets on upload. Retire mail authority explicitly
 * on an existing owned installation, through its version-checked secret door. */
export async function transitionMailBindings(context,declaration,env){
 const environment=context.options.environment??'production';
 let state;
 try{state=JSON.parse(await readFile(join(context.root,'.rer','deploy',environment+'.json'),'utf8'));}
 catch(error){if(error.code==='ENOENT')return;throw missing('The deployment record could not be read; no mail bindings were changed.');}
 if(!state.receipt)return;
 const off=outboundEmailOff(env),retired=new Set(state.retiredSecrets??[]);
 const mail=(declaration.secrets??[]).filter(item=>mailInputNames.includes(item.binding)||mailInputNames.includes(item.environment));
 const active=new Set(selectedMailDeclaration(declaration,env).secrets.map(item=>item.binding));
 const changes=off?mail.filter(item=>!retired.has(item.binding)):mail.filter(item=>active.has(item.binding)&&retired.has(item.binding)&&typeof env[item.environment]==='string'&&env[item.environment].trim());
 for(const item of changes){
  try{
   await ownerCommand(['secret','--declaration','deploy.json','--environment',environment,off?'--unset':'--set',item.binding],env,{cwd:context.root,localOnlyKeys:context.localOnlyKeys});
  }catch{throw missing(`Mail configuration stopped while ${off?'retiring':'restoring'} ${item.binding}. Run the same deploy command again; no secret values are shown.`);}
 }
 if(changes.length)context.store.report(`deploy: ${off?'retired':'restored'} mail bindings (${changes.length}): ${changes.map(item=>item.binding).sort().join(', ')}`,{names:changes.map(item=>item.binding)});
}
