import assert from 'node:assert/strict'
import {readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'

// Read the actual workerd D1 file only after rer stops its server. This oracle
// neither emulates a binding nor writes credentials; all mutations use native
// routes or public rer export/reset/import commands.
export async function recoveryStorage(root,visit){
 const files=[]
 async function scan(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
   const path=join(directory,entry.name)
   if(entry.isDirectory())await scan(path)
   else if(entry.name.endsWith('.sqlite'))files.push(path)
  }
 }
 await scan(join(root,'.wrangler/state/v3/d1'))
 const matches=[]
 for(const file of files){
  const db=new DatabaseSync(file,{readOnly:true})
  try{if(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('memberships','identity_recovery_requests')").all().length===2)matches.push(file)}finally{db.close()}
 }
 assert.equal(matches.length,1,'one actual native identity database')
 const db=new DatabaseSync(matches[0],{readOnly:true})
 try{return await visit(db)}finally{db.close()}
}
