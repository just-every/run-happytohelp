import {seconds,FIXTURE_TIME} from './corpus.mjs';
import {pageSlice,newer,decodeCursor,encodeCursor} from './pagination.mjs';

export function intercomRoutes({corpus:c,baseUrl}) {
    const person=id=>c.agents.find(p=>p.id===Number(id))??c.contacts.find(p=>p.id===Number(id));
    const author=id=>{const p=person(id);return {id:String(id),type:id<1000?'admin':'user',
        ...(p?.deleted?{}:{name:p?.name,email:p?.email})};};
    const contact=p=>({type:'contact',id:String(p.id),role:'user',name:p.name,email:p.email,
        created_at:seconds(FIXTURE_TIME-90*86400_000),updated_at:seconds(FIXTURE_TIME),
        companies:{type:'list',data:[{type:'company',id:String(p.companyId),company_id:`company-${p.companyId}`}],has_more:false},custom_attributes:{}});
    const attachment=a=>({type:'upload',name:a.filename,url:`${baseUrl}/attachments/${a.id}/${a.filename}`,
        content_type:a.contentType,filesize:a.size,width:0,height:0});
    const conversation=(p,detail)=>({type:'conversation',id:String(p.id),title:p.subject,created_at:seconds(p.createdAt),
        updated_at:seconds(p.updatedAt),state:p.mergedInto?'closed':p.status==='pending'?'snoozed':p.status,
        open:p.status!=='closed'&&!p.mergedInto,read:true,priority:'not_priority',admin_assignee_id:String(p.agentId),
        tags:{type:'tag.list',tags:p.tags.map((name,i)=>({type:'tag',id:String(i+1),name}))},
        contacts:{type:'contact.list',contacts:[{type:'contact',id:String(p.contactId),external_id:`customer-${p.contactId}`}]},
        source:{type:'conversation',id:String(p.comments[0].id),delivered_as:'customer_initiated',subject:p.subject,
            body:`<p>${p.comments[0].body}</p>`,author:author(p.contactId),attachments:p.comments[0].attachments.map(attachment),
            url:null,redacted:false},
        teammates:{type:'admin.list',admins:[{type:'admin',id:String(p.agentId)}]},
        cc:p.cc.map(email=>({type:'contact',email})),
        ...(detail?{conversation_parts:{type:'conversation_part.list',total_count:p.comments.length-1,
            conversation_parts:p.comments.slice(1).map(v=>({type:'conversation_part',id:String(v.id),
                part_type:v.private?'note':'comment',body:`<p>${v.body}</p>`,created_at:seconds(v.createdAt),
                updated_at:seconds(v.createdAt),notified_at:seconds(v.createdAt),author:author(v.authorId),
                attachments:v.attachments.map(attachment),external_id:null,redacted:false}))}}:{})});
    const list=(url,key,rows,{body,page=false}={})=>{
        const target=new URL(url);
        if(body?.pagination?.starting_after)target.searchParams.set('starting_after',body.pagination.starting_after);
        if(body?.pagination?.per_page)target.searchParams.set('per_page',body.pagination.per_page);
        const p=pageSlice(target,rows,{cursorParam:page?null:'starting_after'});
        return {type:key==='conversations'?'conversation.list':'list',[key]:p.rows,total_count:p.total,
            pages:{type:'pages',page:p.number,per_page:p.size,total_pages:p.pages,
                next:p.more?(page?{page:p.number+1,per_page:p.size}:{starting_after:p.cursor,per_page:p.size}):null}};
    };
    return ({url,body,send})=>{
        let match;
        if(url.pathname==='/admins')return send({type:'admin.list',admins:c.agents.filter(p=>!p.deleted).map(p=>({
            type:'admin',id:String(p.id),name:p.name,email:p.email,away_mode_enabled:false,has_inbox_seat:true}))});
        if(url.pathname==='/contacts')return send(list(url,'data',c.contacts.map(contact)));
        if((match=/^\/contacts\/(\d+)$/.exec(url.pathname))) {
            const p=c.contacts.find(p=>p.id===Number(match[1]));return p?send(contact(p)):send({type:'error.list',errors:[{code:'not_found'}]},404);
        }
        if(url.pathname==='/companies')return send(list(url,'data',c.companies.map(p=>({type:'company',id:String(p.id),
            company_id:`company-${p.id}`,name:p.name,created_at:seconds(FIXTURE_TIME-90*86400_000),updated_at:seconds(FIXTURE_TIME)})),{page:true}));
        if(url.pathname==='/companies/scroll') {
            const offset=url.searchParams.has('scroll_param')?decodeCursor(url.searchParams.get('scroll_param')):0;
            const rows=c.companies.slice(offset,offset+100).map(p=>({type:'company',id:String(p.id),
                company_id:`company-${p.id}`,name:p.name,created_at:seconds(FIXTURE_TIME-90*86400_000),updated_at:seconds(FIXTURE_TIME)}));
            return send({type:'company.list',data:rows,scroll_param:encodeCursor(offset+rows.length)});
        }
        const article=p=>({type:'article',id:String(p.id),title:p.title,description:'Delivery information',body:p.body,
            author_id:101,state:p.draft?'draft':'published',parent_id:601,parent_type:'collection',
            created_at:seconds(p.createdAt),updated_at:seconds(p.updatedAt),url:`${baseUrl}/help/articles/${p.id}`});
        if(url.pathname==='/articles')return send(list(url,'data',c.articles.map(p=>{const {body,...ref}=article(p);return ref;}),{page:true}));
        if((match=/^\/articles\/(\d+)$/.exec(url.pathname))) {
            const p=c.articles.find(p=>p.id===Number(match[1]));return p?send(article(p)):send({errors:[{code:'not_found'}]},404);
        }
        if(url.pathname==='/conversations'||url.pathname==='/conversations/search') {
            let rows=c.tickets;
            if(body?.query) {
                if(body.query.field!=='updated_at'||body.query.operator!=='>')return send({errors:[{code:'invalid_query'}]},400);
                rows=newer(rows,String(body.query.value));
            }
            return send(list(url,'conversations',rows.map(p=>conversation(p,false)),{body}));
        }
        if((match=/^\/conversations\/(\d+)$/.exec(url.pathname))) {
            const p=c.tickets.find(p=>p.id===Number(match[1]));return p?send(conversation(p,true)):send({errors:[{code:'not_found'}]},404);
        }
        return false;
    };
}
