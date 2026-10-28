import {asyncWorkRestoreSql} from './async-work-archive.mjs';
import {refuse} from '@runeditrun/rer/errors';
import {PortabilityError} from '@runeditrun/rer/modules/portability';
import {triageRestoreSql} from './triage-archive.mjs';
import {localInstaller} from '@runeditrun/rer/local-installer';
import {developmentTarget,previewTarget} from '@runeditrun/rer/operator-installer';
import {installOperator} from '@runeditrun/rer/operator-install';
import {selectLocalState} from '@runeditrun/rer/local/state';
import {commandAdapter as createCommandAdapter} from '@runeditrun/rer/adapter';
import {hostedDeploy} from './hosted-deploy.mjs';
import {nativeSetupPath} from '../deployment/mail-declaration.mjs';
import {localPortability,withManagedDataImport} from '@runeditrun/rer/portability';
import {localInputDefaults,localOwner,nativeOwner,prepareNativeLocal} from './native-local.mjs';
import {ticketRestoreSql} from './ticket-archive-upgrade.mjs';
import {r4RestoreSql} from './r4-tables.mjs';
import {reportRestoreSql} from './report-archive.mjs';
import {trainingRestoreSql} from './training-archive.mjs';
import {workflowRestoreSql} from './workflow-archive-safety.mjs';
import {workflowLegacyRestoreSql} from './workflow-archive-defaults.mjs';
import {fileRecords} from '@runeditrun/rer/modules/portability/files';
import {checkArchiveSnapshot,readDurableObjects,snapshotSql} from './durable-objects.mjs';
import {platformMigrationLedger} from './migration-ledger.mjs';
import * as model from './ui/seed.mjs';

const environment=context=>({...process.env,...context.vars,APP_ORIGIN:context.origin,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_INCLUDE_PROCESS_ENV:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',X_LOCAL_EXPLORER:'false'});
const preview=context=>{
 const [command,args,options]=previewTarget(context);
 return [command,args,{...options,env:{...environment(context),...options.env,APP_ORIGIN:context.origin,RER_ORIGIN_KEY:'APP_ORIGIN'}}];
};
const dev=async context=>{
 const env={...environment(context),RER_DEV_ORIGIN:context.origin};
 await context.run('Building development assets','pnpm',['run','build:assets'],{step:'build',cwd:context.root,signal:context.signal,env});
 const [command,args,options]=developmentTarget(context);
 return [command,args,{...options,env:{...env,...options.env,APP_ORIGIN:context.origin}}];
};
export const adapter=localInstaller({
 node:'22.20.0',features:{...model.features,hosting:false,github:false},
 guard:async({root})=>{await selectLocalState(root);},prepare:prepareNativeLocal,
 // Export, import and Managed data intake read the collected migrations, also in a checkout that never ran setup.
 prepareData:context=>[process.execPath,['scripts/migrations.mjs'],{cwd:context.root,signal:context.signal,heavy:false}],
 migrate:async context=>{
  // Existing dev installs reuse their build. Collect newly added source SQL
  // before the migration phase, including an upgrade started with rer dev.
  // Copying SQL is lightweight filesystem work, not a second heavy job.
  await context.run('Collecting local migrations',process.execPath,['scripts/migrations.mjs'],{step:'setup',cwd:context.root,signal:context.signal,heavy:false});
  return ['pnpm',['exec','wrangler','d1','migrations','apply','DB','--local','--persist-to',context.demo?.state??'.wrangler/state','--config','wrangler.jsonc']];
 },
 // Add only missing keys: settings saved by 0.3 (setup token, local mail, optional
 // provider settings) are kept byte-for-byte while this release's local keys are added.
 secrets:{originKey:'APP_ORIGIN',values:context=>({APP_ORIGIN:context.origin,H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'})},
 build:['pnpm',['run','build:app']],
 start:preview,owner:nativeOwner,localOwner,signIn:{returnTo:'/setup'},
});
export const install=(root,input,store,onApp,signal)=>installOperator(root,input,store,onApp,signal,adapter.hooks);
const declaration={buckets:{FILES:'FILES'},policyModule:'scripts/installer/portability-policy.mjs',transient:['ConversationSocket connections (messages are in D1)','live teammate presence (who has the dashboard open)','queue execution leases','active sessions and one-use sign-in links','GitHub and integration credentials','local computer pairing, grants and job execution records','local workflow clock overrides; queued workflow sends are cancelled and claimed sends remain uncertain']};
const transfer=localPortability({database:'DB',...declaration});
const d1=(context,label,sql)=>context.store.run(label,'pnpm',['exec','wrangler','d1','execute','DB','--local','--persist-to','.wrangler/state','--config','wrangler.jsonc','--command',sql],{cwd:context.root,signal:context.signal});
async function archiveInput(path){
 try{return await checkArchiveSnapshot(path)}catch(error){
  // Only validator failures become public refusals. Never echo archive values,
  // filesystem errors or private captures in the command's safe diagnostic.
  const message=error instanceof Error?error.message:'';
  const reason=error instanceof PortabilityError
   ? new Set(['content_checksum','part_checksum','archive_checksum','payload_checksum']).has(error.code)?'archive integrity check failed':'invalid archive structure'
   : message==='An archive line exceeds the supported size.'?'an archive record exceeds the supported size'
   : message.startsWith('Restore refused:')?'unsupported or damaged Durable Object snapshot':null;
  if(reason)throw refuse('Import refused before restore: '+reason+'.');
  throw error;
 }
}

const portability=Object.fromEntries(['export','import'].map(verb=>[verb,async context=>{
 let snapshots;
 if(verb==='export'){
  // Durable Object storage enters the archive as a D1 table with its schema and digest.
  if(!await platformMigrationLedger(context))await context.store.run('Applying local data migrations','pnpm',['exec','wrangler','d1','migrations','apply','DB','--local','--persist-to','.wrangler/state','--config','wrangler.jsonc'],{cwd:context.root,signal:context.signal});
  snapshots=await readDurableObjects(context.root);
  await d1(context,'Recording Durable Object storage',snapshotSql(snapshots));
 }else snapshots=await archiveInput(context.path);
 let selected=transfer,upgradeWorkflows=false;
 if(verb==='import'){
  const historical=await Promise.all(['./triage-archive-policy.mjs','./triage-historical-report-policy.mjs','./ticket-archive-policy.mjs','./r4-archive-policy.mjs','./email-archive-policy.mjs','./workflow-archive-policy.mjs','./workflow-archive-ticket-policy.mjs'].map(async module=>({module,policy:(await import(module)).default})));
  // Metadata can select this explicitly supported schema transition, never an
  // executable path supplied by the archive. Base verifies the complete archive.
  for await(const record of fileRecords(context.path))if(record.kind==='manifest'){
   const previous=historical.find(item=>Object.hasOwn(item.policy.acceptedSchemas,record.schema));
   if(previous){selected=localPortability({database:'DB',buckets:{FILES:'FILES'},policyModule:new URL(previous.module,import.meta.url),transient:[]});upgradeWorkflows=previous.policy.excludeTables.includes('workflow_rules');}
   break;
  }
 }
 const result=await selected[verb](context);
 // Restore deliberately suspends business triggers. Rebuild derived search
 // before reporting a completed import, including a resumed import.
 if(verb==='import'){
  if(upgradeWorkflows)await d1(context,'Preparing restored workflow defaults',workflowLegacyRestoreSql);
  await d1(context,'Preparing restored ticket statuses',ticketRestoreSql);
  await d1(context,'Preparing restored saved replies',r4RestoreSql);
  // Ticket normalization can journal a restored conversation through live
  // triggers. Fence that work as well as the archived commands before completion.
  await d1(context,'Fencing archived triage work',triageRestoreSql);
  await d1(context,'Fencing archived workflow actions',workflowRestoreSql);
  await d1(context,'Fencing restored report schedules and bulk replies',reportRestoreSql);
  await d1(context,'Fencing restored evaluations',trainingRestoreSql);
  await d1(context,'Fencing restored background work',asyncWorkRestoreSql);
  await d1(context,'Rebuilding conversation search',"INSERT INTO inbox_message_search(inbox_message_search) VALUES('rebuild')");
 }
 // The receipt names the Durable Object storage the archive carries (exported) or carried (restored).
 return {...result,durableObjects:snapshots.map(({namespace,className,records,digest})=>({namespace,className,records:Array.isArray(records)?records.length:records,digest}))};
} ]));
// Local setup keeps the entered-password hook; hosted deploy has no installer input.
// Give rer its standard claim contract so it observes 303/409 and retires the token.
const hostedLifecycle={...adapter,hooks:{...adapter.hooks,owner:{path:'/auth/bootstrap',tokenKey:'H2H_SETUP_TOKEN',returnTo:'/setup'}}};
export const commandAdapter=createCommandAdapter(adapter,{
 generatedOutputs:['.generated','migrations/core','delivery-artifact','management/integration/deployment-spec.json','management/integration/managed-deploy.json',nativeSetupPath,'public/downloads','public/widget.js'],
 site:{entry:'src/site/pages.ts',config:'vite.site.config.ts',output:'.rer/site',declaration:'deploy-site.json'},
 product:model.product.name,dev,preview,signInPath:'/login',devIdentity:{entry:'src/dev/server.ts',output:['dist','delivery-artifact'],emailLinkTest:'tests/first-run/cli-sign-in.mjs'},verify:['pnpm',['run','verify:app']],deploy:hostedDeploy('deploy.json',hostedLifecycle),
 // Platform's Managed data ZIP enters through Base's bounded intake: its SQL runs only in a private
 // sandbox, every source table, index, trigger and view is placed by this checkout's migrations and
 // policy, and the native archive it stages goes through this same restore and its fences.
 portability:{...portability,managedDataImport:context=>withManagedDataImport(context,{binding:'DB',...declaration},portability.import),hostedExport:['node','scripts/installer/hosted-export.mjs']},
 setup:{get manifestFile(){return process.env.MAIL_PROVIDER==='rer'?'rer-setup.json':nativeSetupPath;}},browserModule:'scripts/installer/ui/seed.mjs',input:{names:{email:'OWNER_EMAIL',name:'OWNER_NAME'},defaults:localInputDefaults},
 localPrerequisites:async({vars})=>vars.H2H_LOCAL==='true'&&vars.EMAIL_PROVIDER==='development',
});
