interface Token {text:string;kind:'word'|'name'|'literal'|'symbol'|'bind';depth:number;index?:number;start:number;end:number}
const unsupported=(detail:string):never=>{throw new Error(`KNOWLEDGE_SQL_WRITE_SHAPE: ${detail}`)}
const keyword=(token:Token|undefined,text:string)=>token?.kind==='word'&&token.text.toLowerCase()===text

/** Lexing protects quoted text and comments, and numbers every parameter before
 * selecting write expressions. Predicate parameters still consume bind slots. */
function tokens(sql:string){
 const result:Token[]=[];let at=0,depth=0,next=0
 while(at<sql.length){
  const char=sql[at],begin=at
  if(/\s/.test(char)){at++;continue}
  if(sql.startsWith('--',at)){const end=sql.indexOf('\n',at+2);at=end<0?sql.length:end+1;continue}
  if(sql.startsWith('/*',at)){const end=sql.indexOf('*/',at+2);if(end<0)unsupported('unterminated comment');at=end+2;continue}
  if("'\"`[".includes(char)){
   const end=char==='['?']':char;let text='',closed=false;at++
   while(at<sql.length){if(sql[at]===end){if(char!=='['&&sql[at+1]===end){text+=end;at+=2;continue}at++;closed=true;break}text+=sql[at++]}
   if(!closed)unsupported('unterminated quote')
   result.push({text,kind:char==="'"?'literal':'name',depth,start:begin,end:at});continue
  }
  if(char==='?'){
   const start=++at;while(/\d/.test(sql[at]||'x'))at++
   const explicit=sql.slice(start,at),number=explicit?Number(explicit):next+1
   if(!Number.isSafeInteger(number)||number<1)unsupported('invalid parameter number')
   next=Math.max(next,number);result.push({text:'?',kind:'bind',depth,index:number-1,start:begin,end:at});continue
  }
  if(/[:@$]/.test(char))unsupported('named parameters require positional bindings')
  const word=sql.slice(at).match(/^[\p{L}\p{N}_$]+/u)?.[0]
  if(word){result.push({text:word,kind:'word',depth,start:at,end:at+word.length});at+=word.length;continue}
  if(char===')'&&--depth<0)unsupported('unbalanced parentheses')
  result.push({text:char,kind:'symbol',depth,start:at,end:at+1});at++
  if(char==='(')depth++
 }
 if(depth)unsupported('unbalanced parentheses')
 const end=result.findIndex(token=>token.text===';'&&token.kind==='symbol'&&token.depth===0)
 if(end>=0){if(end!==result.length-1)unsupported('multiple statements');result.pop()}
 return result
}
function name(token:Token|undefined){
 if(!token||!['word','name','literal'].includes(token.kind))return unsupported('identifier required')
 return token.text.toLowerCase()
}
function split(list:Token[],depth:number){
 const parts:Token[][]=[[]]
 for(const token of list){if(token.text===','&&token.kind==='symbol'&&token.depth===depth)parts.push([]);else parts.at(-1)!.push(token)}
 if(parts.some(part=>!part.length))unsupported('empty expression')
 return parts
}
function close(list:Token[],start:number){
 const end=list.findIndex((token,index)=>index>start&&token.text===')'&&token.kind==='symbol'&&token.depth===list[start].depth)
 if(end<0)unsupported('missing closing parenthesis')
 return end
}
const clause=(token:Token,words:string[])=>token.depth===0&&token.kind==='word'&&words.includes(token.text.toLowerCase())
const conflict=(list:Token[],index:number)=>clause(list[index],['on'])&&keyword(list[index+1],'conflict')

/** Zero-based indexes of all stored bound values, including identity columns. Supply
 * PRAGMA table_info column order for INSERTs without an explicit column list.
 * Storage-to-storage SELECT expressions already carry canonical references. */
function analyse(sql:string,columns?:readonly string[],guardRanges?:Token[][]):{table:string;indexes:number[]|null}{
 const list=tokens(sql),root=list.findIndex(token=>clause(token,['insert','replace','update','delete']))
 if(root<0||root>0&&!keyword(list[0],'with'))return unsupported('expected write statement')
 const kind=list[root].text.toLowerCase();let at=root+1
 if(keyword(list[at],'or'))at+=2
 if(kind==='insert'||kind==='replace'){if(keyword(list[at],'into'))at++;else if(kind==='insert')unsupported('INSERT INTO required')}
 if(kind==='delete'){if(!keyword(list[at],'from'))unsupported('DELETE FROM required');at++}
 let table=name(list[at++])
 if(list[at]?.text==='.'){at++;table=name(list[at++])}
 if(keyword(list[at],'as')){at++;name(list[at++])}
 if(kind==='delete')return {table,indexes:[]}
 const indexes=new Set<number>();let missingColumns=false
 const rowSources=(expression:Token[],from:number,depth:number)=>{
  if(!keyword(expression[from],'from'))return
  let stop=expression.findIndex((token,index)=>index>from&&token.depth===depth&&token.kind==='word'&&(['where','group','having','window','order','limit','union','intersect','except','returning'].includes(token.text.toLowerCase())||keyword(token,'on')&&keyword(expression[index+1],'conflict')))
  if(stop<0)stop=expression.length
  for(let index=from+1;index<stop;index++)if(expression[index].depth===depth&&expression[index].kind==='word'&&['json_each','json_tree'].includes(expression[index].text.toLowerCase())&&expression[index+1]?.text==='('){const finish=close(expression,index+1);include(expression.slice(index+2,finish));index=finish}
 }
 const include=(expression:Token[]):void=>{
  for(let index=0;index<expression.length;index++){
   const token=expression[index]
   if(keyword(token,'select')){
    let end=expression.findIndex((entry,position)=>position>index&&entry.depth===token.depth&&entry.kind==='word'&&['from','where','group','having','window','order','limit','union','intersect','except'].includes(entry.text.toLowerCase()))
    if(end<0)end=expression.length
    include(expression.slice(index+1,end))
    rowSources(expression,end,token.depth)
    const next=expression.findIndex((entry,position)=>position>=end&&entry.depth===token.depth&&keyword(entry,'select'))
    if(next<0)return
    index=next-1
   }else if(token.kind==='symbol'&&token.text==='('){const end=close(expression,index);include(expression.slice(index+1,end));index=end}
   else if(token.kind==='bind')indexes.add(token.index!)
  }
 }
 const project=(names:readonly string[]|undefined,expressions:Token[][],guard=true)=>{
  if(names&&names.length!==expressions.length)unsupported('column/expression count differs')
  expressions.forEach(include);if(guard)guardRanges?.push(expressions[0])
 }
 const assignments=(start:number)=>{
  let end=list.findIndex((token,index)=>index>=start&&(clause(token,['where','returning','order','limit','from'])||conflict(list,index)))
  if(end<0)end=list.length
  const parts=split(list.slice(start,end),0)
  for(const assignment of parts){
   const equals=assignment.findIndex(token=>token.text==='='&&token.kind==='symbol'&&token.depth===0)
   if(equals<1)unsupported('assignment required')
   const lhs=assignment.slice(0,equals),rhs=assignment.slice(equals+1)
   if(!rhs.length)unsupported('assignment value required')
   if(lhs[0].text==='('){
    if(lhs.at(-1)?.text!==')'||rhs[0]?.text!=='('||close(rhs,0)!==rhs.length-1)unsupported('tuple assignment required')
    project(split(lhs.slice(1,-1),1).map(part=>{if(part.length!==1)unsupported('tuple column required');return name(part[0])}),split(rhs.slice(1,-1),1),assignment===parts[0])
   }else{
    if(lhs.length!==1)unsupported('simple assignment column required')
    name(lhs[0]);include(rhs);if(assignment===parts[0])guardRanges?.push(rhs)
   }
  }
 }
 if(kind==='update'){
  if(!keyword(list[at],'set'))unsupported('UPDATE SET required')
  assignments(at+1)
 }else{
  let names:readonly string[]|undefined=columns?.map(column=>column.toLowerCase())
  if(list[at]?.text==='('){
   const end=close(list,at)
   names=split(list.slice(at+1,end),1).map(part=>{if(part.length!==1)unsupported('column name required');return name(part[0])});at=end+1
  }
  missingColumns=!names
  if(keyword(list[at],'default')){if(!keyword(list[at+1],'values'))unsupported('DEFAULT VALUES required');at+=2}
  else if(keyword(list[at],'values')){
   at++
   do{
    if(list[at]?.text!=='(')unsupported('VALUES tuple required')
    const end=close(list,at);project(names,split(list.slice(at+1,end),1));at=end+1
    if(list[at]?.text!==',')break
    at++
   }while(at<list.length)
  }else if(keyword(list[at],'select')){
   do{
    at++;if(keyword(list[at],'distinct')||keyword(list[at],'all'))at++
    let end=list.findIndex((token,index)=>index>=at&&(clause(token,['from','where','group','having','window','order','limit','union','intersect','except','returning'])||conflict(list,index)))
    if(end<0)end=list.length
    const expressions=split(list.slice(at,end),0)
    if(expressions.some(expression=>expression.length===1&&expression[0].text==='*'||expression.length===3&&expression[1].text==='.'&&expression[2].text==='*')){if(guardRanges||list.slice(at,end).some(token=>token.kind==='bind'))unsupported('bound wildcard projection');}
    else project(names,expressions)
    at=end
    rowSources(list,at,0)
    const compound=list.findIndex((token,index)=>index>=at&&(clause(token,['union','intersect','except','returning'])||conflict(list,index)))
    if(compound<0){at=list.length;break}
    at=compound
    if(!clause(list[at],['union','intersect','except']))break
    at++;if(keyword(list[at],'all')||keyword(list[at],'distinct'))at++
    if(!keyword(list[at],'select'))unsupported('compound SELECT required')
   }while(at<list.length)
  }else unsupported('INSERT VALUES or SELECT required')
  while(keyword(list[at],'on')){
   if(!keyword(list[at+1],'conflict'))unsupported('ON CONFLICT required')
   let action=list.findIndex((token,index)=>index>at&&clause(token,['do']))
   if(action<0)unsupported('conflict action required')
   if(keyword(list[action+1],'nothing'))at=action+2
   else if(keyword(list[action+1],'update')&&keyword(list[action+2],'set')){
    assignments(action+3)
    const next=list.findIndex((token,index)=>index>action+2&&(clause(token,['returning'])||conflict(list,index)))
    at=next<0?list.length:next
   }else unsupported('conflict action unsupported')
  }
  if(at<list.length&&!keyword(list[at],'returning'))unsupported('unrecognized INSERT suffix')
 }
 return {table,indexes:missingColumns?null:[...indexes].sort((a,b)=>a-b)}
}

export function textBindingIndexes(sql:string,columns?:readonly string[]){return analyse(sql,columns)}

/** Keep the index observation and write in one SQLite statement. CASE is lazy:
 * the invalid JSON branch aborts the write if an unindexed source was admitted. */
export function guardKnowledgeWrite(sql:string):string{
 const ranges:Token[][]=[];analyse(sql,undefined,ranges)
 const edits=ranges.map(expression=>{
  const depth=expression[0].depth,alias=expression.findIndex(token=>token.depth===depth&&keyword(token,'as'))
  let end=alias<0?expression.length:alias
  if(alias<0&&end>1){
   const last=expression[end-1],prior=expression[end-2],reserved=['end','null','true','false','isnull','notnull']
   const operator=['and','or','is','not','like','glob','regexp','match','escape','collate','in','between','when','then','else']
   if(['word','name'].includes(last.kind)&&!reserved.includes(last.text.toLowerCase())&&(['word','name','literal','bind'].includes(prior.kind)||prior.text===')')&&!operator.includes(prior.text.toLowerCase()))end--
  }
  const start=expression[0].start,finish=expression[end-1].end
  return {start,finish,text:`CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_index_dirty) THEN (${sql.slice(start,finish)}) ELSE json('') END`}
 }).sort((a,b)=>b.start-a.start)
 for(const edit of edits)sql=sql.slice(0,edit.start)+edit.text+sql.slice(edit.finish)
 return sql
}
