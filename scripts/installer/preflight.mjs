import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ownerWorkerName} from '@runeditrun/rer/internal/modules/deploy-kit/owner.mjs';
import {preflightOptions,preflightCredentials,PreflightRefusal} from './preflight-inputs.mjs';
import {providerPreflight} from './provider-preflight.mjs';

try{
 const options=preflightOptions(process.argv.slice(2));
 if(options.help){
  console.log('Usage: pnpm run preflight --consent-read-only [--env-file PATH] [--environment NAME]');
  console.log('Read the Workers subdomain, Worker settings summary and secret names only; no mail or resource changes.');
  console.log('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID privately in the environment or an owned 0600 env file (file wins), never in arguments. Consent is required on each invocation. Default environment: production.');
 }else{
 const credentials=await preflightCredentials(process.cwd(),options);
 let worker;
 try{
  const declaration=JSON.parse(await readFile(join(process.cwd(),'deploy.json'),'utf8'));
  worker=ownerWorkerName(declaration.project,options.environment);
 }catch{throw new PreflightRefusal('Preflight needs a valid deploy.json project and --environment Worker name. Nothing was requested.');}
 await providerPreflight(credentials,worker,line=>console.log(line));
 }
}catch(error){
 console.error('preflight: '+(error instanceof PreflightRefusal?error.message:'Inspection failed before completion; private details withheld.'));
 process.exitCode=1;
}
