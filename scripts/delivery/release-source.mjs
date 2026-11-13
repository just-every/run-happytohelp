import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';

/** Resolve source identity once at build configuration, never in the Worker. */
export function releaseSourceCommit(root) {
 let upstream;
 try { upstream=readFileSync(join(root,'rer-upstream.json'),'utf8'); }
 catch(error) { if(error.code!=='ENOENT')throw error; }
 if(upstream!==undefined){
  let record;
  try { record=JSON.parse(upstream); } catch { throw Error('Invalid rer-upstream.json release provenance'); }
  if(record?.schema!==1 || typeof record.repository!=='string' || !record.repository
   || typeof record.tag!=='string' || !record.tag || !/^[a-f0-9]{40}$/.test(record.commit)){
   throw Error('Invalid rer-upstream.json release provenance');
  }
  // Managed copies have installation commits of their own. The upstream tag's
  // commit, rather than that installation HEAD, identifies the released source.
  return record.commit;
 }
 try {
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],env:{...process.env,GIT_NO_REPLACE_OBJECTS:'1'}}).trim();
  if(realpathSync(git('rev-parse','--show-toplevel'))!==realpathSync(root))return null;
  const commit=git('rev-parse','--verify','HEAD^{commit}');
  return /^[a-f0-9]{40}$/.test(commit)?commit:null;
 } catch { return null; } // Source archives may contain neither provenance nor Git.
}
