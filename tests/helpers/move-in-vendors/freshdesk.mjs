import {iso,FIXTURE_TIME} from './corpus.mjs';
import {pageSlice,newer} from './pagination.mjs';

export function freshdeskRoutes({corpus:c,baseUrl}) {
    const contact=p=>({id:p.id,name:p.deleted?'Deleted agent':p.name,email:p.deleted?null:p.email,
        company_id:p.companyId??null,active:!p.deleted,deleted:p.deleted===true,tags:['import-fixture'],
        created_at:iso(FIXTURE_TIME-90*86400_000),updated_at:iso(FIXTURE_TIME)});
    const agent=p=>({id:p.id,available:true,occasional:false,deactivated:false,ticket_scope:1,
        contact:{name:p.name,email:p.email,active:true},created_at:iso(FIXTURE_TIME-90*86400_000),updated_at:iso(FIXTURE_TIME)});
    const company=p=>({id:p.id,name:p.name,domains:[`company-${p.id}.example.test`],created_at:iso(FIXTURE_TIME-90*86400_000),updated_at:iso(FIXTURE_TIME)});
    const attachment=a=>({id:a.id,name:a.filename,content_type:a.contentType,size:a.size,
        attachment_url:`${baseUrl}/attachments/${a.id}/${a.filename}`,created_at:iso(FIXTURE_TIME-80*86400_000),updated_at:iso(FIXTURE_TIME-80*86400_000)});
    const ticket=p=>({id:p.id,subject:p.subject,description:`<p>${p.comments[0].body}</p>`,description_text:p.comments[0].body,
        status:p.mergedInto?5:({open:2,pending:3,closed:5})[p.status],priority:1,source:1,
        requester_id:p.contactId,responder_id:p.agentId,company_id:p.companyId,group_id:1,
        tags:p.tags,cc_emails:p.cc,to_emails:['support@fixture.example.test'],spam:p.id===5,deleted:false,
        attachments:p.comments[0].attachments.map(attachment),custom_fields:{},
        created_at:iso(p.createdAt),updated_at:iso(p.updatedAt),stats:{status_updated_at:iso(p.updatedAt)}});
    const conversations=p=>p.comments.slice(1).map(v=>({id:v.id,ticket_id:p.id,user_id:v.authorId,
        body:`<p>${v.body}</p>`,body_text:v.body,incoming:v.authorId>=1000,private:v.private,source:0,
        from_email:v.authorId>=1000?`customer-${v.authorId-1000}@fixture.example.test`:'support@fixture.example.test',
        to_emails:[`customer-${p.contactId-1000}@fixture.example.test`],cc_emails:p.cc,bcc_emails:[],
        attachments:v.attachments.map(attachment),created_at:iso(v.createdAt),updated_at:iso(v.createdAt)}));
    const list=(url,rows,send)=>{const p=pageSlice(url,rows);return send(p.rows,200,p.next?{Link:`<${p.next}>; rel="next"`}:{});};
    return ({url,send})=>{
        let match;const path=url.pathname;
        if(path==='/api/v2/agents')return list(url,c.agents.filter(p=>!p.deleted).map(agent),send);
        if((match=/^\/api\/v2\/agents\/(\d+)$/.exec(path))) {
            const p=c.agents.find(p=>p.id===Number(match[1])&&!p.deleted);return p?send(agent(p)):send({description:'Agent not found'},404);
        }
        if(path==='/api/v2/contacts') {
            const deleted=c.agents.filter(p=>p.deleted);
            return list(url,(url.searchParams.get('state')==='deleted'?deleted:c.contacts).map(contact),send);
        }
        if((match=/^\/api\/v2\/contacts\/(\d+)$/.exec(path))) {
            const p=[...c.contacts,...c.agents.filter(p=>p.deleted)].find(p=>p.id===Number(match[1]));
            return p?send(contact(p)):send({description:'Contact not found'},404);
        }
        if(path==='/api/v2/companies')return list(url,c.companies.map(company),send);
        if((match=/^\/api\/v2\/companies\/(\d+)$/.exec(path))) {
            const p=c.companies.find(p=>p.id===Number(match[1]));return p?send(company(p)):send({description:'Company not found'},404);
        }
        if(path==='/api/v2/tickets') {
            // The documented default really only covers the last 30 days. A reader
            // omitting updated_since loses the first 60 days of this fixture.
            let rows=newer(c.tickets,url.searchParams.get('updated_since')??iso(c.clock-30*86400_000));
            rows=rows.filter(p=>url.searchParams.get('filter')==='spam'?p.id===5:p.id!==5);
            rows.sort((a,b)=>a.updatedAt-b.updatedAt||a.id-b.id);
            return list(url,rows.map(ticket),send);
        }
        if((match=/^\/api\/v2\/tickets\/(\d+)(?:\/(conversations))?$/.exec(path))) {
            const p=c.tickets.find(p=>p.id===Number(match[1]));if(!p)return send({description:'Ticket not found'},404);
            return match[2]?list(url,conversations(p),send):send(ticket(p));
        }
        const category={id:601,name:'Customer help',description:'Help with deliveries',visible_in_portals:[1]};
        const folder={id:602,name:'Delivery',description:'Delivery articles',category_id:601,visibility:1};
        const article=p=>({id:p.id,title:p.title,description:p.body,description_text:p.body.replace(/<[^>]*>/g,''),
            folder_id:602,category_id:601,agent_id:101,status:p.draft?1:2,type:1,tags:['shipping'],
            created_at:iso(p.createdAt),updated_at:iso(p.updatedAt)});
        if(path==='/api/v2/solutions/categories')return list(url,[category],send);
        if(path==='/api/v2/solutions/categories/601/folders')return list(url,[folder],send);
        if(path==='/api/v2/solutions/folders/602/articles')return list(url,c.articles.map(p=>{
            const {description,description_text,...ref}=article(p);return ref;}),send);
        if((match=/^\/api\/v2\/solutions\/articles\/(\d+)$/.exec(path))) {
            const p=c.articles.find(p=>p.id===Number(match[1]));return p?send(article(p)):send({description:'Article not found'},404);
        }
        return false;
    };
}
