// Network edge only: the emitted application reads and imports this MIME.
export default async request=>{
 const url=new URL(request.url)
 if(request.method!=='GET'||url.hostname!=='gmail.googleapis.com')throw Error('Unexpected history provider request')
 if(url.pathname.endsWith('/labels'))return Response.json({labels:[{id:'Archive',name:'Archive'}]})
 if(url.pathname.endsWith('/messages'))return Response.json({messages:[{id:'synthetic-happytohelp-browser',threadId:'synthetic-happytohelp-thread'}]})
 if(url.pathname.endsWith('/messages/synthetic-happytohelp-browser'))return Response.json({raw:Buffer.from('From: Synthetic customer <synthetic-happytohelp-browser@example.test>\r\nDate: Tue, 10 Nov 2026 12:00:00 +0000\r\nMessage-ID: <synthetic-happytohelp-browser@example.test>\r\nSubject: Historical parcel question\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlease replace the parcel.').toString('base64url')})
 throw Error('Unexpected history provider endpoint')
}
