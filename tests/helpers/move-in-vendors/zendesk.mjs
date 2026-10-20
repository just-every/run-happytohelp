import {iso,seconds,FIXTURE_TIME} from './corpus.mjs';
import {pageSlice,newer} from './pagination.mjs';
import {emailEvidence} from './email-evidence.mjs';

export function zendeskRoutes({corpus:c,baseUrl}) {
    const person=id=>c.agents.find(p=>p.id===Number(id))??c.contacts.find(p=>p.id===Number(id));
    const user=p=>({id:p.id,name:p.name,email:p.email,role:p.id<1000?'agent':'end-user',
        active:!p.deleted,suspended:p.deleted===true,organization_id:p.companyId??null,
        created_at:iso(FIXTURE_TIME-90*86400_000),updated_at:iso(FIXTURE_TIME),
        ...(p.deleted?{name:'Deleted user',email:null}:{}),url:`${baseUrl}/api/v2/users/${p.id}.json`});
    const organization=p=>({id:p.id,name:p.name,domain_names:[`company-${p.id}.example.test`],
        created_at:iso(FIXTURE_TIME-90*86400_000),updated_at:iso(FIXTURE_TIME)});
    const attachment=a=>({id:a.id,file_name:a.filename,content_type:a.contentType,size:a.size,
        content_url:`${baseUrl}/attachments/${a.id}/${a.filename}`,inline:false,deleted:false});
    const comment=(p,t)=>({id:p.id,type:'Comment',author_id:p.authorId,public:!p.private,body:p.body,
        html_body:`<p>${p.body}</p>`,plain_body:p.body,created_at:iso(p.createdAt),attachments:p.attachments.map(attachment),
        via:{channel:'email',source:{from:{address:person(p.authorId)?.email},to:{address:'support@fixture.example.test'},rel:null}},
        metadata:{system:{},custom:{}}});
    const ticket=p=>({id:p.id,encoded_id:`ZD${String(p.id).padStart(4,'0')}-MAIL`,url:`${baseUrl}/api/v2/tickets/${p.id}.json`,subject:p.subject,
        description:p.comments[0].body,requester_id:p.contactId,submitter_id:p.contactId,
        assignee_id:p.agentId,organization_id:p.companyId,status:p.mergedInto?'closed':p.status==='closed'?'solved':p.status,
        priority:'normal',type:'question',tags:p.tags,collaborator_ids:[],email_cc_ids:[],
        email_ccs:p.cc.map(email=>({user_email:email})),created_at:iso(p.createdAt),updated_at:iso(p.updatedAt),
        via:{channel:'email',source:{from:{address:person(p.contactId)?.email},to:{address:'support@fixture.example.test'},rel:null}}});
    const list=(url,key,rows)=>{
        const p=pageSlice(url,rows,{sizeParam:'page[size]',cursorParam:'page[after]'});
        return {[key]:p.rows,count:p.total,next_page:p.next,previous_page:null,
            meta:{has_more:p.more,after_cursor:p.cursor,before_cursor:null},links:{next:p.next,prev:null}};
    };
    return ({url,send})=>{
        const path=url.pathname.replace(/\.json$/,'');let match;
        if(path==='/api/v2/email_notifications') {
            const filters=['ticket_id','comment_id','notification_id'].filter(key=>url.searchParams.has(`filter[${key}]`));
            if(!filters.length)return send({error:'A notification, comment, or ticket filter is required'},400);
            const rows=c.tickets.flatMap(ticket=>ticket.comments.filter(part=>!part.private&&part.authorId<1000).map(part=>{
                const evidence=emailEvidence(c,'zendesk',ticket.id,part.id);
                return {ticket_id:ticket.id,comment_id:part.id,notification_id:evidence.notificationId,
                    message_id:evidence.messageId,email_id:`fixture-email-${evidence.notificationId}`,
                    created_at:iso(part.createdAt),updated_at:iso(part.createdAt),
                    recipients:evidence.to.map(email_address=>({email_address,user_id:ticket.contactId,
                        delivery_status:{id:5,name:'delivered',code:'200',message:'Email was delivered.'}})),
                    url:`${baseUrl}/api/v2/email_notifications/${evidence.notificationId}`};
            })).filter(row=>filters.every(key=>String(row[key])===url.searchParams.get(`filter[${key}]`)))
                .sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.notification_id-a.notification_id);
            const p=pageSlice(url,rows,{cursorParam:'page[after]'});
            return send({email_notifications:p.rows,meta:{has_more:p.more,after_cursor:p.cursor,before_cursor:null},
                links:{next:p.next,prev:null}});
        }
        if(path==='/api/v2/users'||path==='/api/v2/deleted_users') {
            const roles=[...url.searchParams.getAll('role'),...url.searchParams.getAll('role[]')];
            let rows=path.endsWith('/deleted_users')?c.agents.filter(a=>a.deleted):[...c.agents.filter(a=>!a.deleted),...c.contacts];
            if(roles.length)rows=rows.filter(p=>roles.includes(p.id<1000?'agent':'end-user'));
            return send(list(url,'users',rows.map(user)));
        }
        if((match=/^\/api\/v2\/users\/(\d+)$/.exec(path))) {
            const p=person(match[1]);return p?send({user:user(p)}):send({error:'RecordNotFound'},404);
        }
        if(path==='/api/v2/organizations')return send(list(url,'organizations',c.companies.map(organization)));
        if((match=/^\/api\/v2\/organizations\/(\d+)$/.exec(path))) {
            const p=c.companies.find(p=>p.id===Number(match[1]));return p?send({organization:organization(p)}):send({error:'RecordNotFound'},404);
        }
        if(path==='/api/v2/help_center/articles')return send(list(url,'articles',c.articles.map(p=>({id:p.id,title:p.title,
            body:p.body,draft:p.draft,locale:'en-us',author_id:101,section_id:601,created_at:iso(p.createdAt),
            updated_at:iso(p.updatedAt),html_url:`${baseUrl}/hc/en-us/articles/${p.id}`,permission_group_id:56,user_segment_id:null}))));
        if(path==='/api/v2/incremental/tickets/cursor'||path==='/api/v2/incremental/tickets') {
            const rows=newer(c.tickets,url.searchParams.get('start_time')).sort((a,b)=>a.updatedAt-b.updatedAt||a.id-b.id);
            const p=pageSlice(url,rows,{cursorParam:'cursor'}),endTime=seconds(c.clock-60_000);
            const next=new URL(url);next.searchParams.set('cursor',p.cursor);
            return send({tickets:p.rows.map(ticket),after_cursor:p.cursor,after_url:next.href,
                end_of_stream:!p.more,end_time:endTime,count:p.rows.length,next_page:p.next});
        }
        if(path==='/api/v2/tickets')return send(list(url,'tickets',c.tickets.map(ticket)));
        if((match=/^\/api\/v2\/tickets\/(\d+)(?:\/(comments|audits))?$/.exec(path))) {
            const p=c.tickets.find(p=>p.id===Number(match[1]));if(!p)return send({error:'RecordNotFound'},404);
            if(match[2]==='comments')return send(list(url,'comments',p.comments.map(v=>comment(v,p))));
            if(match[2]==='audits')return send(list(url,'audits',p.mergedInto?[{id:p.id*100,author_id:101,
                created_at:iso(p.updatedAt),ticket_id:p.id,events:[{id:p.id*100+1,type:'Merge',merged_into:p.mergedInto}]}]:[]));
            return send({ticket:ticket(p)});
        }
        return false;
    };
}
