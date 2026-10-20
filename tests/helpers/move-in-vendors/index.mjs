import {createServer} from 'node:http';
import {makeCorpus,changeCorpus,attachmentBytes} from './corpus.mjs';
import {zendeskRoutes} from './zendesk.mjs';
import {intercomRoutes} from './intercom.mjs';
import {helpscoutRoutes} from './helpscout.mjs';
import {freshdeskRoutes} from './freshdesk.mjs';

const routes={zendesk:zendeskRoutes,intercom:intercomRoutes,helpscout:helpscoutRoutes,freshdesk:freshdeskRoutes};
const basic=value=>'Basic '+Buffer.from(value).toString('base64');
const matches=(value,path)=>!value||(value instanceof RegExp?value.test(path):path.includes(value));

/** Local vendor REST server. Every credential below is a synthetic test fixture. */
export async function startVendor(vendor,{tickets=305}={}) {
    if(!Object.hasOwn(routes,vendor))throw new TypeError(`Unsupported vendor ${vendor}`);
    const corpus=makeCorpus(tickets),requestLog=[],violations=[],faults=[];
    const token=`fixture-${vendor}-token`,email='importer@fixture.example.test',docsToken='fixture-helpscout-docs-key';
    const wrongToken='fixture-wrong-token',scopeToken=`${token}-scope`,rateToken=`${token}-rate`;
    let handle,baseUrl;
    const authValue=(value,docs=false)=>docs?basic(value+':X'):vendor==='freshdesk'?basic(value+':X'):
        vendor==='zendesk'?basic(email+'/token:'+value):'Bearer '+value;
    const authorize=(request,docs)=>{
        const actual=request.headers.authorization;
        for(const [value,label] of [[docs?docsToken:token,'valid'],[scopeToken,'scope'],[rateToken,'rate'],[wrongToken,'wrong']]) {
            if(actual===authValue(value,docs))return label;
            // Zendesk supports both OAuth bearer and email/API-token credentials.
            if(vendor==='zendesk'&&!docs&&actual==='Bearer '+value)return label;
        }
        return 'wrong';
    };
    const server=createServer(async(request,response)=>{
        const url=new URL(request.url,baseUrl),docs=vendor==='helpscout'&&url.pathname.startsWith('/v1/');
        const log={method:request.method,path:url.pathname,query:Object.fromEntries(url.searchParams),
            url:url.pathname+url.search,auth:authorize(request,docs),intercomVersion:request.headers['intercom-version']??null,status:null};
        requestLog.push(log);
        const send=(body,status=200,headers={})=>{
            log.status=status;response.writeHead(status,{'Content-Type':'application/json',...headers});
            response.end(JSON.stringify(body));return true;
        };
        try {
            if(log.auth==='scope')return send({error:'insufficient_scope'},403);
            if(log.auth==='rate')return send({error:'rate_limit_exceeded'},429,{'Retry-After':'1'});
            if(log.auth!=='valid')return send({error:'Unauthorized'},401);
            if(vendor==='intercom'&&log.intercomVersion!=='2.16') {
                violations.push({path:log.path,error:'Intercom-Version must be 2.16'});
                return send({error:'Intercom-Version must be 2.16'},400);
            }
            const expectedMethod=vendor==='intercom'&&url.pathname==='/conversations/search'?'POST':'GET';
            if(request.method!==expectedMethod) {
                violations.push({path:log.path,error:`Expected ${expectedMethod}`});
                return send({error:'Method not allowed'},405,{Allow:expectedMethod});
            }
            let body;
            if(request.method==='POST') {
                if(!String(request.headers['content-type']).startsWith('application/json'))return send({error:'JSON content type required'},415);
                const chunks=[];let length=0;
                for await(const chunk of request) {
                    length+=chunk.length;if(length>64*1024)return send({error:'Body too large'},413);
                    chunks.push(chunk);
                }
                try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return send({error:'Invalid JSON'},400);}
                log.body=body;
            }
            for(const fault of faults) {
                if(!fault.active||!matches(fault.path,url.pathname))continue;
                fault.seen++;
                if(fault.seen<=fault.after)continue;
                if(fault.once)fault.active=false;
                if(fault.disconnect){log.status='disconnected';request.socket.destroy();return;}
                return send(fault.body??{error:'fixture_interruption'},fault.status,fault.headers);
            }
            const file=/^\/attachments\/(\d+)(?:\/.*)?$/.exec(url.pathname)
                ??/^\/v2\/conversations\/\d+\/attachments\/(\d+)\/(?:file|data)$/.exec(url.pathname);
            if(file) {
                const attachment=corpus.attachments.find(a=>a.id===Number(file[1]));
                if(!attachment||attachment.missing)return send({error:'Attachment not found'},404);
                const bytes=attachmentBytes(attachment);log.status=200;
                response.writeHead(200,{'Content-Type':attachment.contentType,'Content-Length':String(bytes.length),
                    'Content-Disposition':`attachment; filename="${attachment.filename}"`});
                response.end(bytes);return;
            }
            if(!handle({url,body,request,send})) {
                violations.push({path:log.path,error:'Unknown vendor endpoint'});
                send({error:'Unknown fixture endpoint',path:url.pathname},404);
            }
        } catch(error) {
            violations.push({path:log.path,error:error.message});
            if(!response.headersSent)send({error:error.message},500);else response.destroy(error);
        }
    });
    server.listen(0,'127.0.0.1');
    await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
    baseUrl=`http://127.0.0.1:${server.address().port}`;
    handle=routes[vendor]({corpus,baseUrl});
    const fault=({after=0,status=503,path=null,once=false,disconnect=false,headers={},body}={})=>{
        if(!Number.isSafeInteger(after)||after<0)throw new TypeError('fault.after must be a nonnegative integer');
        const entry={after,status,path,once,disconnect,headers,body,seen:0,active:true};
        faults.push(entry);return ()=>{entry.active=false;};
    };
    return {vendor,baseUrl,docsBaseUrl:baseUrl,token,email,docsToken,wrongToken,scopeToken,rateToken,
        corpus,requestLog,requests:requestLog,violations,
        change:options=>changeCorpus(corpus,options),fault,
        stopAfter:(after,options={})=>fault({...options,after}),
        clearFaults:()=>{faults.length=0;},clearRequests:()=>{requestLog.length=0;violations.length=0;},
        authorization:(value=token,{docs=false}={})=>authValue(value,docs),
        close:()=>new Promise((resolve,reject)=>{
            server.close(error=>error?reject(error):resolve());server.closeAllConnections();
        }),
    };
}
