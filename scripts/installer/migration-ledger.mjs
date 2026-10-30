import {fileURLToPath} from 'node:url';
import {RerError} from '@runeditrun/rer/errors';

// Use Base's read-only preflight before the export's Durable Object capture.
// Platform owns rer_migrations; Wrangler must never prepare that database.
export async function nativeMigrationDecision({root,store,signal}){
 const worker=fileURLToPath(import.meta.resolve('@runeditrun/rer/internal/cli/portability-worker.mjs'));
 const input={root,binding:'DB',buckets:{},policyModule:'scripts/installer/portability-policy.mjs'};
 const child=store.spawn('Checking migration history',process.execPath,[worker,'migration-preflight',JSON.stringify(input)],{
  cwd:root,signal,env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe','ipc'],
 });
 let receipt;
 child.on('message',message=>{receipt=message;});
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 await new Promise(resolve=>{child.once('exit',resolve);child.once('error',resolve);});
 await store.stop(child);
 const status=await closed;
 if(!receipt || typeof receipt!=='object')throw new RerError('transfer_failed','Migration history check ended before it finished.',1);
 if(status.code!==0 || !receipt.ok){
  // Rer 0.2.90 separates the pending checkout filename from its refusal code.
  const reason=receipt.reason==='migration_ledger:unapplied'&&typeof receipt.unapplied==='string'?`${receipt.reason}:${receipt.unapplied}`:receipt.reason??'incomplete';
  throw new RerError(receipt.code??'transfer_failed',`Archive operation refused (${reason}).`,receipt.exitCode??1);
 }
 if(typeof receipt.nativeApply!=='boolean')throw new RerError('transfer_failed','Migration history check returned no ledger decision.',1);
 return receipt.nativeApply;
}
