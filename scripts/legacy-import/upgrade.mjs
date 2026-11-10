#!/usr/bin/env node
// Upgrade one workspace imported from legacy by an earlier importer to what an import writes now: legacy storage URLs in
// its messages, articles, logo, widget background and avatars become native URLs, and its widget settings get the legacy
// widget translation where the seed has not changed them since import (src/modules/legacy-import/upgrade.ts).
// Run it once per imported workspace after applying migration 321; a second run changes nothing. It writes only under
// the workspace's import lease, so never while an erasure there runs. stdout is one JSON object of counts.
import {registerHooks} from 'node:module'
import {existsSync} from 'node:fs'
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(url))return next(url.href,context)}return next(specifier,context)}})
const usage='Usage: node scripts/legacy-import/upgrade.mjs --project LEGACY-PROJECT-ID (--persist-to path | --database D1-NAME --bucket R2-NAME)'
const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);if(i<0)return undefined;const v=args[i+1];if(!v||v.startsWith('--'))throw new Error(usage);return v}
const project=value('--project'),persist=value('--persist-to'),database=value('--database'),bucket=value('--bucket')
if(!project||Boolean(persist)===Boolean(database||bucket)||Boolean(database)!==Boolean(bucket))throw new Error(usage)
const {localTarget,remoteTarget}=await import('./target.mjs')
const {takeDeltaLease}=await import('../../src/modules/legacy-import/lease.ts')
const {upgradeWorkspace}=await import('../../src/modules/legacy-import/upgrade.ts')
process.env.WRANGLER_LOG??='warn'
const progress=line=>process.stderr.write(JSON.stringify({at:new Date().toISOString(),...line})+'\n')
const target=persist?await localTarget(persist):await remoteTarget({database,bucket})
try{
 const lease=await takeDeltaLease(()=>target.env.DB,project,progress)
 try{console.log(JSON.stringify(await upgradeWorkspace(target.env,project,lease,{renew:async()=>target.renew?.()}),null,2))}
 finally{await lease.release()}
}finally{await target.close()}
