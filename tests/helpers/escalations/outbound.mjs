// Each provider is a real local HTTP server. Never contact a live provider.
export default async request=>{
 const u=new URL(request.url);if(!['localhost','127.0.0.1'].includes(u.hostname)||u.protocol!=='http:')throw Error('External request prohibited');
 // Buffering changes the transport framing. Node computes its own length.
 const headers=new Headers(request.headers);for(const name of ['content-length','transfer-encoding','connection','host'])headers.delete(name);
 return fetch(u,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer()});
};
