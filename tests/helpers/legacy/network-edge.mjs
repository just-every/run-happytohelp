// Only the local D1/R2 binding transport may leave the import command.
// Record before refusing, so a swallowed provider error still fails the journey.
import {appendFileSync} from 'node:fs'
import net from 'node:net'
import tls from 'node:tls'
import {syncBuiltinESMExports} from 'node:module'
const local=host=>['localhost','127.0.0.1','::1','[::1]'].includes(host)
function refuse(host){
 appendFileSync(process.env.H2H_LEGACY_NETWORK_LOG,JSON.stringify({host:String(host)})+'\n')
 throw Error('Unexpected external request during legacy import')
}
const connect=net.Socket.prototype.connect
net.Socket.prototype.connect=function(...args){
 const first=args[0],options=Array.isArray(first)?first[0]:first
 const host=typeof options==='object'?options.host:typeof args[1]==='string'?args[1]:'localhost'
 if(!(typeof options==='object'&&options.path)&&!local(host||'localhost'))refuse(host)
 return connect.apply(this,args)
}
const secureConnect=tls.connect
tls.connect=function(...args){
 const options=typeof args[0]==='object'?args[0]:typeof args[1]==='object'?args[1]:{host:typeof args[1]==='string'?args[1]:'localhost'}
 const host=options.host||options.socket?.remoteAddress||'localhost'
 if(!local(host))refuse(host)
 return secureConnect.apply(this,args)
}
const fetch=globalThis.fetch
globalThis.fetch=(input,...args)=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url)
 if(!local(url.hostname))refuse(url.hostname)
 return fetch(input,...args)
}
syncBuiltinESMExports()
