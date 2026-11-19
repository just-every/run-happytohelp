import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

// The importer's private directories hold package rows (the context index) or the
// remote binding's config. Each is named for the process that owns it, so one left
// behind by a killed run is recognised and removed when the next import starts.
const owned=/^h2h-legacy-(context|remote)-(\d+)-/;

/** A private directory for this process, removed by its owner when it ends. */
export const privateDirectory=kind=>mkdtemp(path.join(tmpdir(),`h2h-legacy-${kind}-${process.pid}-`));

/** Remove the private directories of importer processes that are no longer running.
 * Returns the names removed. */
export async function removeStaleDirectories(){
  const removed=[];
  for(const name of await readdir(tmpdir())){
    const pid=Number(name.match(owned)?.[2]);
    if(!pid||pid===process.pid||running(pid))continue;
    await rm(path.join(tmpdir(),name),{recursive:true,force:true});removed.push(name);
  }
  return removed;
}
export function running(pid){try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
