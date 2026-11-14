// Qualification wrapper: a disposable, loopback-only synthetic MySQL instance.
// It reads no service configuration and stops only the child it starts.
import {spawn,execFileSync} from 'node:child_process'
import {mkdtemp,rm,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import net from 'node:net'
import mysql from 'mysql2/promise'
const directory=await mkdtemp(join(tmpdir(),'rehearsal-mysql-')),socket=join(directory,'mysql.sock')
const candidates=['/opt/homebrew/opt/mysql@8.4/bin/mysqld','/usr/local/homebrew/opt/mysql@8.4/bin/mysqld','/usr/local/opt/mysql@8.4/bin/mysqld','/usr/sbin/mysqld'];let binary
for(const path of candidates){try{await access(path);binary=path;break}catch{}}
if(!binary)binary=execFileSync('which',['mysqld'],{encoding:'utf8'}).trim()
const port=await new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p))})})
const run=(command,args,options={})=>new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:'inherit',...options});child.once('error',reject);child.once('exit',code=>resolve(code))})
let server
try{
 const initialized=await run(binary,['--no-defaults','--initialize-insecure','--datadir='+directory])
 if(initialized!==0)throw Error('Isolated MySQL initialization failed')
 server=spawn(binary,['--no-defaults','--datadir='+directory,'--socket='+socket,'--port='+port,'--bind-address=127.0.0.1','--mysqlx=OFF','--pid-file='+join(directory,'server.pid')],{stdio:['ignore','ignore','inherit']})
 server.once('error',error=>{console.error(error.message)})
 const deadline=Date.now()+30000
 for(;;){try{const c=await mysql.createConnection({socketPath:socket,user:'root'});await c.end();break}catch(error){if(server.exitCode!==null||Date.now()>deadline)throw error;await new Promise(resolve=>setTimeout(resolve,100))}}
 const code=await run(process.execPath,['--test','tests/legacy-export.mjs'],{env:{...process.env,LEGACY_TEST_MYSQL_HOST:'127.0.0.1',LEGACY_TEST_MYSQL_PORT:String(port),LEGACY_TEST_MYSQL_USER:'root',LEGACY_TEST_MYSQL_PASSWORD:''}})
 process.exitCode=code
}finally{
 if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve))}
 await rm(directory,{recursive:true,force:true})
}
