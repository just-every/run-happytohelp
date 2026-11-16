// Synthetic documented Zendesk JSONL, generated independently of the reader.
// 1,000 distinct requesters expose reference-query scaling hidden by shared contacts.
export function largeUndoFixture(count=1000){
const stamp='2024-01-01T00:00:00Z',records=[{user:{id:900001,role:'agent',name:'synthetic-hh-900001',email:'synthetic-hh-900001@example.test',created_at:stamp}}];
for(let i=1;i<=count;i++)records.push({user:{id:i,role:'end-user',name:`synthetic-hh-${i}`,email:`synthetic-hh-${i}@example.test`,created_at:stamp}});
for(let i=1;i<=count;i++)records.push({ticket:{id:10000+i,requester_id:i,subject:`synthetic-hh-${10000+i}`,status:['new','open','pending','hold','solved','closed'][(i-1)%6],created_at:stamp,updated_at:stamp,tags:['Billing','Priority'],via:{channel:'email'},comment_count:2,comments:[{id:i*10+1,author_id:i,public:true,body:`synthetic-hh-${i} public comment`,created_at:stamp},{id:i*10+2,author_id:900001,public:false,body:`synthetic-hh-${i} private note`,created_at:stamp}]}});
records.push({macro:{id:50001,title:'synthetic-hh-50001',restriction:null,created_at:stamp,updated_at:stamp,actions:[{field:'comment_value',value:'Hello, how can we help?'}]}},{article:{id:60001,title:'synthetic-hh-60001',body:'Public guide',draft:false,user_segment_id:null,created_at:stamp,updated_at:stamp}});
let source=records.map(JSON.stringify).join('\n')+'\n';const padding=count===1000?794723-Buffer.byteLength(source):0;if(padding<0)throw Error('oversize');for(let i=0;i<count;i++)records[count+1+i].ticket.comments[0].body+='x'.repeat(Math.floor(padding/count)+(i<padding%count?1:0));source=records.map(JSON.stringify).join('\n')+'\n';return source;
}
