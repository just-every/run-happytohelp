import {cp,mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const run=promisify(execFile),checkout=resolve('.');
const local=path=>import(pathToFileURL(join(checkout,path)));
const {archiveStorage}=await local('tests/helpers/rer-archive.mjs');
const {splitSqlStatements}=await local('scripts/delivery/base/sql-statements.mjs');
const tmp=await mkdtemp(join(tmpdir(),'hh-platform-native-repro-'));
const nodeModules=join(checkout,'node_modules');
const current=join(nodeModules,'@runeditrun/rer');
const previous=resolve(process.argv[2]);
async function target(label,packageRoot,additive=false){
 const root=join(tmp,label);
 await mkdir(root);
 for(const path of ['scripts','src','migrations','docs','management','package.json','seed.json','OPERATIONS.json','OPERATIONS.md','ACCEPTANCE.md','rer-setup.json','wrangler.jsonc','deploy.json']) await cp(join(checkout,path),join(root,path),{recursive:true});
 if(packageRoot===current)await symlink(nodeModules,join(root,'node_modules'),'dir');
 else{
  await mkdir(join(root,'node_modules','@runeditrun'),{recursive:true});
  for(const name of await readdir(nodeModules))if(name!=='@runeditrun')await symlink(join(nodeModules,name),join(root,'node_modules',name));
  await symlink(packageRoot,join(root,'node_modules','@runeditrun','rer'));
  const packageFile=join(root,'package.json'),manifest=JSON.parse(await readFile(packageFile));
  manifest.devDependencies['@runeditrun/rer']='0.2.121';
  await writeFile(packageFile,JSON.stringify(manifest));
 }
 if(additive)await writeFile(join(root,'migrations/9999_archive_addition.sql'),'CREATE TABLE archive_addition(id TEXT PRIMARY KEY,value TEXT);\n');
 return root;
}

async function cli(root,pkg,args){
 const result=await run(process.execPath,[join(pkg,'global/rer.mjs'),...args,'--non-interactive','--json'],{cwd:root,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'}})
  .then(r=>({exit:0,stdout:r.stdout}),error=>({exit:error.code,stdout:error.stdout}));
 const errors=(result.stdout??'').split('\n').flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}})
  .filter(x=>x.event==='error').map(({code,message})=>({code,message}));
 console.log(JSON.stringify({command:args[0],fixture:root.slice(tmp.length+1),exit:result.exit,errors}));
 return result.exit;
}
try{
 const root=await target('platform-source',current);
 await run(process.execPath,['scripts/migrations.mjs'],{cwd:root});
 const directory=join(root,'.generated/migrations');
 await archiveStorage(root,async({DB})=>{
  await DB.prepare('CREATE TABLE rer_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
  for(const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()){
   const sql=await readFile(join(directory,name),'utf8');
   const sha256=createHash('sha256').update(sql).digest('hex');
   await DB.batch([DB.prepare('INSERT INTO rer_migrations(name,sha256) VALUES(?,?)').bind(name,sha256),...splitSqlStatements(sql).map(statement=>DB.prepare(statement))]);
  }
  await DB.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('synthetic-repro','Retained workspace','synthetic-widget','https://example.test',1)").run();
 });
 const archive=join(root,'exports/platform.rer');
 if(await cli(root,current,['export','--output',archive]))throw Error('Platform fixture export failed');
 await Promise.all([[current,'native-0.2.125'],[previous,'native-0.2.121']].map(async([pkg,label])=>{
  const dest=await target(label,pkg,true);
  await cli(dest,pkg,['import','--input',archive,'--yes']);
 }));
}finally{await rm(tmp,{recursive:true,force:true});}
