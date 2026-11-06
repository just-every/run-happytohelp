#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readDeployEnvFile} from '@runeditrun/rer/internal/modules/deploy-kit/env-file.mjs';
import {memberFor,issueGrant,signInLink,SigninRefusal} from './hosted-signin/grant.mjs';
import {openDeployment} from './hosted-signin/deployment.mjs';

// Sign an existing owner or admin in to a hosted install without mail. With the
// Cloudflare credentials that deployed it, write one single-use, 15-minute grant
// into the deployment's D1 and print the native sign-in link once. Nothing is
// sent, and the link is never written to disk, a log or a receipt.
const usage='usage: node scripts/hosted-signin.mjs --environment <env> (--project <workspaceId> | --email <memberEmail>) [--open] [--json] [--env-file <file>]';
const root=fileURLToPath(new URL('..',import.meta.url));
const fail=(message,code=1)=>{process.stderr.write(`${message}\n`);process.exit(code);};

function openBrowser(link){
 const [command,args]=process.platform==='darwin'?['open',[link]]:process.platform==='win32'?['cmd',['/c','start','""',link]]:['xdg-open',[link]];
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:'ignore',detached:true});
  child.once('error',()=>reject(new SigninRefusal('No default browser could be opened. Run the command again without --open.')));
  child.once('spawn',()=>{child.unref();resolve();});
 });
}

let options;
try{options=parseArgs({args:process.argv.slice(2),strict:true,allowPositionals:false,options:{environment:{type:'string'},project:{type:'string'},email:{type:'string'},open:{type:'boolean'},json:{type:'boolean'},'env-file':{type:'string'}}}).values;}
catch{fail(usage,2);}
if(!options.environment||Boolean(options.project)===Boolean(options.email))fail(usage,2);
try{
 const env={...process.env};
 if(options['env-file'])Object.assign(env,await readDeployEnvFile(root,resolve(options['env-file'])).catch(error=>{throw new SigninRefusal(`The --env-file could not be used: ${error.code==='ENOENT'?'no such file':error.message}.`);}));
 const {db,origin}=await openDeployment({root,environment:options.environment,env});
 const member=await memberFor(db,{project:options.project,email:options.email});
 const grant=await issueGrant(db,member);
 const link=signInLink(origin,grant.token);
 const summary={email:grant.email,expiresAt:grant.expiresAt};
 if(options.open){
  await openBrowser(link);
  process.stdout.write(options.json?`${JSON.stringify(summary)}\n`:`Opened a one-time sign-in link for ${grant.email} in your browser. It expires ${new Date(grant.expiresAt).toISOString()}.\n`);
 }else if(options.json)process.stdout.write(`${JSON.stringify({link,...summary})}\n`);
 else{
  process.stderr.write(`One-time sign-in link for ${grant.email}. It works once and expires ${new Date(grant.expiresAt).toISOString()}. It is not saved anywhere; open it now:\n`);
  process.stdout.write(`${link}\n`);
 }
}catch(error){
 if(error instanceof SigninRefusal)fail(error.message);
 // Provider and transport failures print their code only: a message could quote a credential.
 fail(`Sign-in failed: ${/^[a-z0-9-]{1,80}$/.test(error?.message)?error.message:'unexpected error'}. No sign-in link was issued.`);
}
