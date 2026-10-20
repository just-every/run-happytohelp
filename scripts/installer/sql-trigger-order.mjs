/** SQLite permits punctuation immediately after CASE's END. Wrangler's command
 * splitter does not, so emit those complete triggers after the other schema.
 * Parsing here preserves every byte inside each statement, including literals. */
function statements(sql){
 const result=[];let start=0,word='',quote=null,line=false,block=false,trigger=false,depth=0,first='';
 const flush=()=>{if(!word)return;const token=word.toUpperCase();if(!first)first=token;if(first==='CREATE'&&token==='TRIGGER')trigger=true;if(trigger){if(token==='BEGIN'||token==='CASE')depth++;else if(token==='END')depth--;}word='';};
 for(let i=0;i<sql.length;i++){
  const c=sql[i],next=sql[i+1];
  if(line){if(c==='\n')line=false;continue;}
  if(block){if(c==='*'&&next==='/'){block=false;i++;}continue;}
  if(quote){if(c===quote){if(next===quote)i++;else quote=null;}continue;}
  if(c==='-'&&next==='-'){flush();line=true;i++;continue;}
  if(c==='/'&&next==='*'){flush();block=true;i++;continue;}
  if(c==="'"||c==='"'||c==='`'||c==='['){flush();quote=c==='['?']':c;continue;}
  if(/[a-z0-9_$]/i.test(c)){word+=c;continue;}
  flush();
  if(c===';'&&(!trigger||depth===0)){
   result.push({sql:sql.slice(start,i+1),trigger});start=i+1;trigger=false;first='';depth=0;
  }
 }
 flush();if(sql.slice(start).trim())result.push({sql:sql.slice(start),trigger});return result;
}
function punctuatedEnd(sql){
 const bare=sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\//g,' ');
 return /\bEND[^;\s\w]/i.test(bare);
}
export function orderSqlTriggers(sql){
 const parts=statements(sql),ordinary=parts.filter(p=>!p.trigger),triggers=parts.filter(p=>p.trigger);
 triggers.sort((a,b)=>Number(punctuatedEnd(a.sql))-Number(punctuatedEnd(b.sql)));
 return [...ordinary,...triggers].map(p=>p.sql.trim()).join('\n')+'\n';
}
