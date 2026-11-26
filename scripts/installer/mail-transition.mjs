import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {main as ownerCommand} from '@runeditrun/rer/internal/modules/deploy-kit/owner-cli.mjs';
import {withStateLock,writeOwnerState} from '@runeditrun/rer/modules/deploy-kit/owner';
import {committedSource} from '@runeditrun/rer/internal/cli/deploy-source.mjs';
import {missing} from '@runeditrun/rer/errors';
import {mailInputNames,outboundEmailOff} from '../deployment/environment.mjs';

const mailSecrets=declaration=>(declaration.secrets??[]).filter(item=>mailInputNames.includes(item.binding)||mailInputNames.includes(item.environment));
const supplied=(env,name)=>typeof env[name]==='string'&&env[name].trim();

async function readRecord(path){
 try{return JSON.parse(await readFile(path,'utf8'));}
 catch(error){if(error.code!=='ENOENT')throw error;}
}

async function recordInputs(path,inputs,merge=false){
 try{
  await withStateLock(path,async()=>{
   const state=await readRecord(path);
   if(!state?.receipt)throw Error('missing-owner-receipt');
   const next=merge?{...state.mailSecretInputs,...inputs}:inputs;
   if(!isDeepStrictEqual(state.mailSecretInputs,next))await writeOwnerState(path,{...state,mailSecretInputs:next});
  });
 }catch{throw missing('The deployment record could not save the mail input names.');}
}

/** Rer inherits held secrets on upload. Change them explicitly when their
 * declared input changes, using the same owner door as mail retirement. */
export async function transitionMailBindings(context,{basePath,declaration,path,env},deploy){
 const {root,options,store,localOnlyKeys,signal}=context;
 const environment=options.environment??'production',record=join(root,'.rer','deploy',environment+'.json');
 let state;
 try{state=await readRecord(record);}
 catch{throw missing('The deployment record could not be read. No mail bindings were changed.');}
 const active=mailSecrets(path===basePath?declaration:JSON.parse(await readFile(join(root,path),'utf8')));
 if(state?.receipt){
  const retired=new Set(state.retiredSecrets??[]),previous=state.mailSecretInputs??{};
  const owner=(verb,selected,extra=[])=>ownerCommand([verb,'--declaration',selected,'--environment',environment,...extra],env,{cwd:root,localOnlyKeys,signal});
  const change=async(items,flag,selected,action,done)=>{
   for(const item of items){
    try{await owner('secret',selected,[flag,item.binding]);}
    catch{throw missing(`Mail configuration stopped while ${action} ${item.binding}. No secret values are shown.`);}
    // A later build or upload can fail after the key has already changed.
    if(action==='resetting')await recordInputs(record,{[item.binding]:item.environment},true);
   }
   const names=items.map(item=>item.binding).sort();
   if(names.length)store.report(`deploy: ${done} mail bindings (${names.length}): ${names.join(', ')}`,{names});
  };
  if(outboundEmailOff(env)){
   await change(mailSecrets(declaration).filter(item=>!retired.has(item.binding)),'--unset',basePath,'retiring','retired');
  }else{
   const remapped=active.filter(item=>!retired.has(item.binding)&&Object.hasOwn(previous,item.binding)&&previous[item.binding]!==item.environment);
   if(remapped.length){
    committedSource(root,options);
    let liveSecrets;
    try{({liveSecrets}=await owner('inspect',path));}
    catch{throw missing('The deployment could not verify the held mail bindings. No mail bindings were changed.');}
    const held=remapped.filter(item=>liveSecrets.includes(item.binding));
    const absent=held.find(item=>!supplied(env,item.environment));
    if(absent)throw missing(`Changing ${absent.binding} needs ${absent.environment} in the private deployment inputs. No mail bindings were changed.`);
    await change(held,'--set',path,'resetting','reset');
   }
   await change(active.filter(item=>retired.has(item.binding)&&supplied(env,item.environment)),'--set',path,'restoring','restored');
  }
 }
 const result=await deploy();
 if(result.deployed)await recordInputs(record,Object.fromEntries(active.map(item=>[item.binding,item.environment])));
 return result;
}
