import assert from 'node:assert/strict';
import {seedScaleOracles,scalePath,formulaComments} from './scale-seed.mjs';

// Sort the seeded durations directly, independently of the product's SQL ranks.
function distribution(values){
 const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;
 return {count:n,median:n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2,p90:sorted[Math.ceil(n*.9)-1]};
}
function rates(rows){
 const closed=rows.filter(row=>!row.reopened),rated=closed.filter(row=>row.value!==null);
 const ai=closed.filter(row=>row.outcome==='ai').length,positive=rated.filter(row=>row.value===1).length;
 return {aiResolution:{count:ai,total:closed.length,rate:closed.length?ai/closed.length:null},
  satisfaction:{positive,total:rated.length,rate:rated.length?positive/rated.length:null}};
}
// Parse records, not lines: quoted cells can contain commas, quotes, tabs and CR.
function parseCSV(text){
 const rows=[];let row=[],value='',quoted=false;
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(char==='"'){
   if(quoted&&text[i+1]==='"'){value+='"';i++}else quoted=!quoted;
  }else if(!quoted&&char===','){row.push(value);value=''}
  else if(!quoted&&char==='\r'&&text[i+1]==='\n'){row.push(value);rows.push(row);row=[];value='';i++}
  else value+=char;
 }
 assert.equal(quoted,false,'CSV quotes close');
 assert.equal(value,'','CSV ends with a complete record');
 assert.deepEqual(row,[]);
 return rows;
}
async function streamedCSV(response){
 assert.equal(response.status,200);
 assert.match(response.headers.get('Content-Type'),/text\/csv/);
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='',chunks=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;text+=decoder.decode(value,{stream:true});chunks++}}
 finally{reader.releaseLock()}
 text+=decoder.decode();
 return {text,rows:parseCSV(text),chunks};
}

export async function proveScaleOracles(h){
 const {fixtures,emptyId}=await seedScaleOracles(h),expected={...rates(fixtures),firstResponse:distribution(fixtures.map(row=>row.response)),firstResolution:distribution(fixtures.map(row=>row.resolution))};
 const response=await h.raw(scalePath),body=await response.text();
 assert.equal(response.status,200);
 assert.ok(Buffer.byteLength(body)<16000,'aggregate response stays bounded with 10,001 conversations');
 const report=JSON.parse(body);
 assert.equal(report.volume,10001,'all persisted native conversations enter the cohort');
 assert.deepEqual(report.firstResponse,expected.firstResponse,'response median and nearest-rank p90');
 assert.deepEqual(report.firstResolution,expected.firstResolution,'first resolution survives later cycles and reopenings');
 assert.deepEqual(report.aiResolution,expected.aiResolution,'one latest outcome per currently closed conversation, including unknowns');
 assert.deepEqual(report.satisfaction,expected.satisfaction,'one latest rating per currently closed conversation');
 assert.equal(report.range.timezone,'America/New_York');
 assert.equal(report.range.startAt,Date.parse('2026-03-07T05:00:00Z'));
 assert.equal(report.range.endAt,Date.parse('2026-03-10T04:00:00Z'));
 assert.equal(report.range.endAt-report.range.startAt,71*3600000,'three local days span the DST change');
 const daily=['2026-03-07','2026-03-08','2026-03-09'].map(date=>{
  const rows=fixtures.filter(row=>row.day===date),day=rates(rows);
  return {date,conversations:rows.length,resolved:day.aiResolution.total,ai:day.aiResolution.count,rated:day.satisfaction.total,positive:day.satisfaction.positive};
 });
 assert.deepEqual(report.daily,daily,'DST daily buckets and every rate reconcile independently');
 assert.equal(report.comments.length,10,'latest comments are bounded');
 const currentIds=new Set(fixtures.filter(row=>!row.reopened&&row.value!==null).map(row=>row.id));
 assert.ok(report.comments.every(row=>currentIds.has(row.conversationId)));

 const detail=await streamedCSV(await h.raw(scalePath+'&format=conversations.csv'));
 assert.ok(detail.chunks>1,'detail export is streamed');
 const [header,...rows]=detail.rows;
 assert.equal(rows.length,10001,'CSV includes every matching conversation, beyond 10,000');
 const byId=new Map(rows.map(row=>[row[0],row]));
 assert.equal(byId.size,10001,'no repeated row at page boundaries');
 assert.ok(byId.has('bulk-10001'),'last seeded row survives all export pages');
 const column=name=>{const index=header.indexOf(name);assert.ok(index>=0,name);return index};
 for(const fixture of fixtures){
  const row=byId.get(fixture.id);assert.ok(row,fixture.id);assert.equal(row.length,header.length);
  assert.equal(row[column('Created (UTC)')],new Date(fixture.created).toISOString());
  assert.equal(Number(row[column('First response (seconds)')]),fixture.response/1000);
  assert.equal(Number(row[column('First resolution (seconds)')]),fixture.resolution/1000);
  assert.equal(row[column('Status')],fixture.reopened?'open':'resolved','reopened history remains open in detail');
  assert.equal(row[column('Latest outcome')],fixture.outcome);
  assert.equal(row[column('Latest rating')],fixture.value===null?'':fixture.value===1?'up':'down');
  const comment=fixture.value===null?'':fixture.comment;
  const dangerous=formulaComments.slice(0,-1).includes(comment);
  assert.equal(row[column('Latest comment')],dangerous?"'"+comment:comment,'all formula-leading cells are inert, including tab and CR');
 }
 for(const row of detail.rows)for(const cell of row)assert.doesNotMatch(cell,/^[\t\r]|^\s*[=+@-]/,'no unsafe CSV cell');
 for(const id of ['scale-before','scale-end','scale-imported','scale-legacy','scale-foreign',emptyId])assert.ok(!byId.has(id),'analytics excludes '+id);

 const summary=await streamedCSV(await h.raw(scalePath+'&format=summary.csv'));
 const metrics=new Map(summary.rows.filter(row=>row.length===2));
 for(const [label,value] of [
  ['Conversations',10001],['First response sample',10001],['First resolution sample',10001],
  ['First response median seconds',expected.firstResponse.median/1000],['First response p90 seconds',expected.firstResponse.p90/1000],
  ['First resolution median seconds',expected.firstResolution.median/1000],['First resolution p90 seconds',expected.firstResolution.p90/1000],
  ['Currently resolved',expected.aiResolution.total],['AI resolutions',expected.aiResolution.count],['AI resolution rate',expected.aiResolution.rate],
  ['Rated resolutions',expected.satisfaction.total],['Thumbs up',expected.satisfaction.positive],['Satisfaction rate',expected.satisfaction.rate]
 ])assert.equal(metrics.get(label),String(value),'complete summary '+label);
 const dayHeader=summary.rows.findIndex(row=>row[0]==='Date');
 assert.deepEqual(summary.rows.slice(dayHeader+1),daily.map(day=>Object.values(day).map(String)),'summary counts every row in each local day');
 for(const row of summary.rows)for(const cell of row)assert.doesNotMatch(cell,/^[\t\r]|^\s*[=+@-]/);
 assert.doesNotMatch(summary.text,/bulk-|scale-imported|scale-legacy|scale-foreign|Latest comment/);
 assert.ok(!summary.text.includes(emptyId));

 // The second workspace has its own exact cohort; neither read nor export admits foreign rows.
 const foreignPath=scalePath.replace('/projects/p/','/projects/q/');
 assert.equal((await h.raw(scalePath,{actor:'foreign'})).status,403);
 assert.equal((await h.raw(foreignPath)).status,403);
 const foreign=await h.call(foreignPath,{actor:'foreign'});
 assert.equal(foreign.volume,1);assert.deepEqual(foreign.firstResponse,{count:0,median:null,p90:null});
 assert.deepEqual(foreign.aiResolution,{count:0,total:0,rate:null});
 const foreignCSV=await streamedCSV(await h.raw(foreignPath+'&format=conversations.csv',{actor:'foreign'}));
 assert.equal(foreignCSV.rows.length,2);assert.equal(foreignCSV.rows[1][0],'scale-foreign');

 await h.db.prepare('UPDATE session_factors SET verified_at=? WHERE token_hash=?').bind(Date.now()-20*60000,h.tokenHash('owner')).run();
 const denied=await h.raw(scalePath+'&format=transcripts.json');assert.equal(denied.status,403);
 assert.equal((await denied.json()).code,'step_up_required');
 await h.db.prepare('UPDATE session_factors SET verified_at=? WHERE token_hash=?').bind(Date.now(),h.tokenHash('owner')).run();
 const transcriptResponse=await h.raw(scalePath+'&format=transcripts.json');
 assert.equal(transcriptResponse.status,200);assert.equal(transcriptResponse.headers.get('Cache-Control'),'no-store');
 const history=await transcriptResponse.json(),threads=new Map(history.conversations.map(row=>[row.id,row]));
 assert.equal(history.conversations.length,10006);assert.equal(threads.size,10006);
 for(const fixture of fixtures)assert.equal(threads.get(fixture.id).messages.length,2,'both persisted messages export at scale');
 for(const id of ['scale-before','scale-end','scale-imported','scale-legacy'])assert.equal(threads.get(id).messages.length,1,'complete history retains '+id);
 assert.deepEqual(threads.get(emptyId).messages,[],'complete history retains empty widget conversations');
 assert.ok(!threads.has('scale-foreign'));
 assert.equal((await h.raw(scalePath+'&format=transcripts.json',{actor:'foreign'})).status,403);
 assert.equal(h.external,0,'no provider or external service was used');
}
