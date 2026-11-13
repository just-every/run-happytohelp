import {readdir,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'

// Historical replay can supply a different checkout. Cache SQL per source root,
// never prepared statements or installed state: every harness still starts empty.
const sources=new Map()
async function statements(sourceRoot){
 const directory=resolve(sourceRoot,'migrations')
 if(!sources.has(directory))sources.set(directory,(async()=>{
  const files=(await readdir(directory)).filter(file=>file.endsWith('.sql')).sort()
  return (await Promise.all(files.map(async file=>{
   const source=(await readFile(join(directory,file),'utf8')).replace(/^\s*--[^\n]*$/gm,'')
   return [...source.matchAll(/\s*(CREATE TRIGGER[\s\S]*?END;|[^;]+;)/g)].map(([,sql])=>sql)
  }))).flat()
 })())
 return sources.get(directory)
}
export async function migrateNativeHarness(db,sourceRoot){
 await db.batch((await statements(sourceRoot)).map(sql=>db.prepare(sql)))
}
