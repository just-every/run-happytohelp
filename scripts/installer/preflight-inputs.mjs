import {readDeployEnvFile} from '@runeditrun/rer/internal/modules/deploy-kit/env-file.mjs';
import {hexId} from '@runeditrun/rer/internal/modules/deploy-kit/validation.mjs';

export class PreflightRefusal extends Error {}

export function preflightOptions(args){
 if(args.length===1&&args[0]==='--help')return {help:true};
 const options={environment:'production',consent:false};
 for(let i=0;i<args.length;i++){
  const arg=args[i];
  if(arg==='--consent-read-only'&&!options.consent){options.consent=true;continue;}
  const key=arg==='--env-file'?'envFile':arg==='--environment'?'environment':undefined;
  if(!key)throw new PreflightRefusal('Read-only preflight accepts no write verbs, deployment flags or credential arguments. Use --consent-read-only, --env-file PATH and --environment NAME only.');
  if(!args[i+1]||args[i+1].startsWith('-')||options[key]!==undefined&&key!=='environment')
   throw new PreflightRefusal('Preflight needs a single value for --env-file or --environment.');
  options[key]=args[++i];
 }
 if(!options.consent)throw new PreflightRefusal('Preflight needs explicit --consent-read-only for this invocation. Nothing was requested.');
 return options;
}

export async function preflightCredentials(root,{envFile}){
 // Same private input reader and precedence as deploy: environment, then the
 // owned private file wins. No local settings, generated secrets or token argv.
 let file={};
 if(envFile){
  try{file=await readDeployEnvFile(root,envFile);}
  catch{throw new PreflightRefusal('Preflight --env-file must be a readable, owned 0600 regular KEY=VALUE file without local-only settings. Nothing was requested.');}
 }
 const env={...process.env,...file},token=env.CLOUDFLARE_API_TOKEN,accountId=env.CLOUDFLARE_ACCOUNT_ID;
 if(!token)throw new PreflightRefusal('Preflight needs CLOUDFLARE_API_TOKEN in the private environment or --env-file. Nothing was requested.');
 if(!accountId)throw new PreflightRefusal('Preflight needs CLOUDFLARE_ACCOUNT_ID in the private environment or --env-file. Nothing was requested.');
 if(!/^[A-Za-z0-9_-]{20,256}$/.test(token))throw new PreflightRefusal('Preflight needs a valid CLOUDFLARE_API_TOKEN shape (20–256 ASCII letters, digits, underscores or hyphens). Nothing was requested.');
 if(!hexId(accountId))throw new PreflightRefusal('Preflight needs a valid CLOUDFLARE_ACCOUNT_ID shape (32 hexadecimal digits, not all zero). Nothing was requested.');
 return {accountId,token};
}
