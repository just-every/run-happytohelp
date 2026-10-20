// Synthetic identities only. This corpus never reads configured provider credentials.
export const FIXTURE_TIME = Date.parse('2026-10-20T00:00:00Z');
const DAY = 86_400_000;
export const iso = value => new Date(value).toISOString();
export const seconds = value => Math.floor(value / 1000);

export function makeCorpus(count) {
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('tickets must be a nonnegative integer');
    const agents = Array.from({length:7}, (_, i) => ({
        id:101+i, name:`${i < 5 ? 'Active' : 'Deleted'} Agent ${i+1}`,
        email:`agent-${i+1}@fixture.example.test`, deleted:i >= 5,
    }));
    const companies = Array.from({length:12}, (_, i) => ({id:501+i, name:`Fixture Company ${i+1}`}));
    const contacts = Array.from({length:Math.max(count, 1)}, (_, i) => ({
        id:1001+i, name:`Customer ${i+1}`, email:`customer-${i+1}@fixture.example.test`,
        companyId:companies[i % companies.length].id,
    }));
    const attachments = Array.from({length:Math.min(45, count)}, (_, i) => ({
        id:9001+i, ticketId:i+1, filename:i === 43 ? 'large-evidence.bin' : `evidence-${i+1}.txt`,
        contentType:i === 43 ? 'application/octet-stream' : 'text/plain',
        size:i === 43 ? 8*1024*1024 : Buffer.byteLength(`Fixture evidence ${i+1}\n`),
        missing:i === 44,
    }));
    const tickets = Array.from({length:count}, (_, i) => {
        const id = i+1;
        const createdAt = FIXTURE_TIME - 90*DAY + Math.round(i / Math.max(count-1,1) * 89*DAY);
        const ticket = {id, subject:`Delivery question ${id}`, contactId:contacts[i].id,
            companyId:contacts[i].companyId, agentId:agents[i % agents.length].id,
            createdAt, updatedAt:createdAt+7200_000, status:['open','pending','closed'][i % 3],
            tags:['import-fixture', i % 2 ? 'delivery' : 'billing'], cc:[`cc-${id}@fixture.example.test`],
            mergedInto:count >= 3 && id === count-1 ? count-2 : null, comments:[]};
        // Ticket one crosses a 100-comment page boundary; all other tickets have a public
        // customer message, public agent reply, and private note.
        const length = id === 1 ? 107 : 3;
        ticket.comments = Array.from({length}, (_, j) => ({
            id:id*1000+j+1, ticketId:id, authorId:j === 0 ? ticket.contactId : ticket.agentId,
            private:j % 3 === 2, body:j === 0 ? `Where is delivery ${id}?` : j % 3 === 2
                ? `Internal investigation for delivery ${id}, note ${j}.` : `Public delivery update ${id}, reply ${j}.`,
            createdAt:createdAt+j*60_000, attachments:j === 0 ? attachments.filter(a=>a.ticketId===id) : [],
        }));
        return ticket;
    });
    const articles = Array.from({length:6}, (_, i) => ({id:701+i, title:`Shipping guide ${i+1}`,
        body:`<p>Shipping guide ${i+1}: allow three business days.</p>`, draft:i===5,
        createdAt:FIXTURE_TIME-80*DAY, updatedAt:FIXTURE_TIME-2*DAY}));
    return {tickets, agents, contacts, companies, attachments, articles, clock:FIXTURE_TIME,mergedConversationId:100_000+count};
}

export function changeCorpus(corpus, options={}) {
    corpus.clock += 60_000;
    const at = options.at == null ? corpus.clock : typeof options.at === 'number' ? options.at : Date.parse(options.at);
    if (!Number.isFinite(at)) throw new TypeError('invalid change time');
    corpus.clock = Math.max(corpus.clock, at);
    const requested = options.addTickets ?? 1;
    const added = [];
    for (let i=0; i<requested; i++) {
        const id = Math.max(0,...corpus.tickets.map(t=>t.id))+1;
        const contact = {id:1000+id,name:`Customer ${id}`,email:`customer-${id}@fixture.example.test`,companyId:501};
        corpus.contacts.push(contact);
        const ticket={id,subject:`Delta delivery question ${id}`,contactId:contact.id,companyId:501,agentId:101,
            createdAt:at,updatedAt:at,status:'open',tags:['import-fixture','delta'],cc:[],mergedInto:null,
            comments:[{id:id*1000+1,ticketId:id,authorId:contact.id,private:false,body:`New delta request ${id}.`,createdAt:at,attachments:[]}]};
        corpus.tickets.push(ticket);added.push(id);
    }
    const replyId = options.replyTo ?? (corpus.tickets.length ? 1 : null);
    let reply = null;
    if (replyId !== null && options.reply !== false) {
        const ticket=corpus.tickets.find(t=>t.id===Number(replyId));
        if (!ticket) throw new Error(`Unknown reply ticket ${replyId}`);
        reply={id:Math.max(...ticket.comments.map(c=>c.id))+1,ticketId:ticket.id,authorId:101,
            private:options.private===true,body:options.body??`Delta public reply for ${ticket.id}.`,createdAt:at,attachments:[]};
        ticket.comments.push(reply);ticket.updatedAt=at;
    }
    const statusId=options.statusTicket ?? (corpus.tickets.length > 1 ? 2 : null);
    if (statusId !== null && options.status !== false) {
        const ticket=corpus.tickets.find(t=>t.id===Number(statusId));
        if (!ticket) throw new Error(`Unknown status ticket ${statusId}`);
        ticket.status=options.status??'closed';ticket.updatedAt=at;
    }
    return {at,added,replyId:reply?.id??null,statusTicket:statusId};
}

export function attachmentBytes(attachment) {
    return attachment.size === 8*1024*1024 ? Buffer.alloc(attachment.size, 0x61)
        : Buffer.from(`Fixture evidence ${attachment.id-9000}\n`);
}
