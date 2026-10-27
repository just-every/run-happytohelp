/** Find the operation outside CTE bodies, strings, identifiers and comments. */
export function isReadOnlySql(sql:string){
 const tokens=sql.match(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][A-Za-z_0-9]*|[()]/g)??[]
 let depth=0
 for(const token of tokens){
  if(token==='('){depth++;continue}
  if(token===')'){depth--;continue}
  if(depth!==0||!/^[A-Za-z_]/.test(token))continue
  const word=token.toUpperCase()
  if(['SELECT','PRAGMA','EXPLAIN'].includes(word))return true
  if(['INSERT','UPDATE','DELETE','REPLACE','CREATE','ALTER','DROP'].includes(word))return false
 }
 return false
}
