import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {cloudflare} from '@runeditrun/rer/modules/deploy-kit/provider';
import {ownerTarget,readOwnerState,sameDeployment} from '@runeditrun/rer/modules/deploy-kit/owner';
import {activeWorker} from '@runeditrun/rer/internal/modules/deploy-kit/worker.mjs';
import {hostedD1} from '../installer/hosted-d1.mjs';
import {SigninRefusal} from './grant.mjs';

const refuse=message=>new SigninRefusal(message);
const hexId=value=>/^[a-f0-9]{32}$/i.test(value);

/** The D1 database of the Worker this checkout deployed, and the application origin its links open.
 * Refuses unless the live Worker is still the one the checkout's deploy record names. */
export async function openDeployment({root,environment,env,fetch}){
 if(!/^[a-z][a-z0-9-]{0,39}$/.test(environment))throw refuse('--environment must name a deployed environment, such as production.');
 for(const name of ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN'])if(!env[name]?.trim())throw refuse('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, the Cloudflare credentials that deployed this environment, in the environment or an owned 0600 --env-file.');
 if(!hexId(env.CLOUDFLARE_ACCOUNT_ID)||/[\r\n]/.test(env.CLOUDFLARE_API_TOKEN))throw refuse('CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is not a valid Cloudflare value.');
 let project;
 try{project=JSON.parse(await readFile(join(root,'deploy.json'),'utf8')).project;}catch{throw refuse('This checkout has no readable deploy.json.');}
 const api=cloudflare({accountId:env.CLOUDFLARE_ACCOUNT_ID,token:env.CLOUDFLARE_API_TOKEN,...(fetch?{fetch}:{})});
 const target=await ownerTarget(api,{project,environment});
 const statePath=join(root,'.rer','deploy',`${environment}.json`);
 let state;
 try{state=await readOwnerState(statePath,target);}catch{throw refuse(`This checkout has no readable deployment record for the ${environment} environment. Run it from the checkout that deployed it.`);}
 if(!state.receipt||state.pendingUpload||state.pendingSecret)throw refuse(`This checkout has no completed deployment of the ${environment} environment. Run rer deploy --environment ${environment} first.`);
 const live=await activeWorker(api,target.worker);
 if(!live||!sameDeployment(live,state.receipt.provider))throw refuse(`The ${environment} Worker is no longer the one this checkout deployed, so no sign-in link was issued. Run rer deploy --environment ${environment} first.`);
 const ids=Object.values(state.owned.d1).filter(entry=>entry.status==='created'&&entry.id).map(entry=>entry.id);
 if(ids.length!==1)throw refuse(`The ${environment} deployment record names ${ids.length} D1 databases; expected one.`);
 const db=hostedD1({accountId:env.CLOUDFLARE_ACCOUNT_ID,databaseId:ids[0],token:env.CLOUDFLARE_API_TOKEN});
 const table=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='magic_signins'").first();
 if(!table)throw refuse(`The ${environment} installation has no sign-in links yet. Run rer deploy --environment ${environment} to upgrade it first.`);
 return {db,origin:state.receipt.origin??target.origin};
}
