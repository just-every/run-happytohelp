import {iso,FIXTURE_TIME} from './corpus.mjs';
import {hal,docsPage,newer} from './pagination.mjs';
import {emailEvidence,originalEmail} from './email-evidence.mjs';

// These links intentionally remain canonical. Tests inject a transport which sends
// canonical requests to the local server; product host validation stays exercised.
const INBOX='https://api.helpscout.net';
export function helpscoutRoutes({corpus:c}) {
    const person=id=>c.agents.find(p=>p.id===Number(id))??c.contacts.find(p=>p.id===Number(id));
    const reference=id=>{const p=person(id);return {id,type:id<1000?'user':'customer',
        ...(p?.deleted?{}:{first:p?.name.split(' ')[0],last:p?.name.split(' ').slice(1).join(' '),email:p?.email})};};
    const customer=p=>({id:p.id,firstName:p.name.split(' ')[0],lastName:p.name.split(' ').slice(1).join(' '),
        organization:`Fixture Company ${p.companyId-500}`,organizationId:p.companyId,
        createdAt:iso(FIXTURE_TIME-90*86400_000),updatedAt:iso(FIXTURE_TIME),
        _embedded:{emails:[{id:p.id+10_000,value:p.email,type:'work'}]},
        _links:{self:{href:`${INBOX}/v2/customers/${p.id}`}}});
    const organization=p=>({id:p.id,name:p.name,domains:[`company-${p.id}.example.test`]});
    const attachment=(a,ticket)=>({id:a.id,filename:a.filename,mimeType:a.contentType,size:a.size,state:'valid',
        _links:{self:{href:`${INBOX}/v2/conversations/${ticket}/attachments/${a.id}`},
            data:{href:`${INBOX}/v2/conversations/${ticket}/attachments/${a.id}/data`},
            download:{href:`${INBOX}/v2/conversations/${ticket}/attachments/${a.id}/file`}}});
    const threads=p=>p.comments.map(v=>({id:v.id,type:v.private?'note':v.authorId>=1000?'customer':'message',
        state:'published',status:p.status==='open'?'active':p.status,body:`<p>${v.body}</p>`,
        createdAt:iso(v.createdAt),createdBy:reference(v.authorId),customer:reference(p.contactId),
        to:['support@fixture.example.test'],cc:p.cc,bcc:[],source:{type:'email',via:v.authorId>=1000?'customer':'user'},
        _embedded:{attachments:v.attachments.map(a=>attachment(a,p.id))}}));
    const conversation=p=>({id:p.id,number:p.id,threads:p.comments.filter(part=>!part.private).length+(p.id===1?1:0),type:'email',folderId:1,mailboxId:1,
        status:p.status==='open'?'active':p.status,state:'published',subject:p.subject,preview:p.comments[0].body,
        primaryCustomer:reference(p.contactId),createdBy:reference(p.contactId),assignee:reference(p.agentId),
        createdAt:iso(p.createdAt),userUpdatedAt:iso(p.updatedAt),closedAt:p.status==='closed'?iso(p.updatedAt):null,
        cc:p.cc,bcc:[],tags:p.tags.map((tag,i)=>({id:i+1,tag,color:'#777777'})),
        _links:{self:{href:`${INBOX}/v2/conversations/${p.id}`},threads:{href:`${INBOX}/v2/conversations/${p.id}/threads`},
            primaryCustomer:{href:`${INBOX}/v2/customers/${p.contactId}`}}});
    const article=p=>({id:String(p.id),number:p.id,collectionId:'601',categories:['602'],status:p.draft?'notpublished':'published',
        hasDraft:p.draft,name:p.title,text:p.body,slug:`shipping-guide-${p.id}`,keywords:['shipping'],
        publicUrl:`https://fixture.example.test/article/${p.id}`,createdBy:101,updatedBy:101,
        createdAt:iso(p.createdAt),updatedAt:iso(p.updatedAt),lastPublishedAt:p.draft?null:iso(p.updatedAt)});
    return ({url,send})=>{
        const canonical=new URL(url.pathname+url.search,INBOX);let match;
        if(url.pathname==='/v2/users')return send(hal(canonical,'users',c.agents.filter(p=>!p.deleted).map(p=>({
            id:p.id,firstName:p.name.split(' ')[0],lastName:p.name.split(' ').slice(1).join(' '),email:p.email,
            role:'user',type:'user',timezone:'Australia/Brisbane',createdAt:iso(FIXTURE_TIME-90*86400_000)}))));
        if(url.pathname==='/v2/customers')return send(hal(canonical,'customers',c.contacts.map(customer)));
        if((match=/^\/v2\/customers\/(\d+)$/.exec(url.pathname))) {
            const p=c.contacts.find(p=>p.id===Number(match[1]));return p?send(customer(p)):send({message:'Customer not found'},404);
        }
        if(url.pathname==='/v2/organizations')return send(hal(canonical,'organizations',c.companies.map(organization)));
        if(url.pathname==='/v2/conversations') {
            let rows=newer(c.tickets,url.searchParams.get('modifiedSince'));
            if(url.searchParams.get('status')!=='all')rows=rows.filter(p=>p.status==='open');
            return send(hal(canonical,'conversations',rows.map(conversation)));
        }
        if((match=/^\/v2\/conversations\/(\d+)\/threads\/(\d+)\/original-source$/.exec(url.pathname))) {
            const ticket=c.tickets.find(p=>p.id===Number(match[1]));
            const part=ticket?.comments.find(p=>p.id===Number(match[2]));
            if(!part||part.private||part.authorId<1000)return send({message:'Original email source unavailable'},404);
            return send({original:originalEmail(emailEvidence(c,'helpscout',ticket.id,part.id),part)});
        }
        if((match=/^\/v2\/conversations\/(\d+)(?:\/(threads))?$/.exec(url.pathname))) {
            // A stale merged conversation redirects; its thread collection returns 404.
            const mergedId=c.mergedConversationId;
            if(Number(match[1])===mergedId&&c.tickets.length) return match[2]
                ?send({message:'Conversation was merged'},404)
                :send({},301,{Location:`${INBOX}/v2/conversations/${c.tickets[0].id}`});
            const p=c.tickets.find(p=>p.id===Number(match[1]));if(!p)return send({message:'Conversation not found'},404);
            if(match[2]) {
                const values=threads(p);
                if(p.id===1)values.push({id:mergedId*1000,type:'lineitem',state:'published',status:'active',
                    body:'Conversation merged',createdAt:iso(p.updatedAt),createdBy:reference(101),
                    action:{type:'merged',text:'Conversation merged',associatedEntities:{originalConversation:mergedId}},
                    _embedded:{attachments:[]}});
                return send(hal(canonical,'threads',values));
            }
            return send(conversation(p));
        }
        if(url.pathname==='/v1/collections')return send(docsPage(url,'collections',[{id:'601',siteId:'600',name:'Customer help',
            slug:'customer-help',visibility:'public',articleCount:c.articles.length,publishedArticleCount:c.articles.filter(p=>!p.draft).length}]));
        if(/^\/v1\/collections\/601\/categories$/.test(url.pathname))return send(docsPage(url,'categories',[
            {id:'602',collectionId:'601',name:'Delivery',slug:'delivery',visibility:'public'}]));
        if(/^\/v1\/(collections\/601|categories\/602)\/articles$/.test(url.pathname))return send(docsPage(url,'articles',
            c.articles.map(p=>{const {text,...ref}=article(p);return ref;})));
        if((match=/^\/v1\/articles\/(\d+)$/.exec(url.pathname))) {
            const p=c.articles.find(p=>p.id===Number(match[1]));if(!p)return send({error:'Article not found'},404);
            const value=article(p);
            if(url.searchParams.get('draft')==='true')value.text='<p>Draft: '+p.title+'</p>';
            return send({article:value});
        }
        return false;
    };
}
