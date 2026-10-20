/** Preserve RFC header occurrences and unfolding, without parsing the MIME body
 * or interpreting quoted text as headers. Message-ID validation belongs to the
 * destination threading normalizer, not the vendor transport. */
const retained=new Set(['message-id','in-reply-to','references','from','to','cc','reply-to'])
export function readEmailHeaders(original:string):Record<string,string[]> {
 const end=original.search(/\r?\n\r?\n/)
 if(end<0)throw new Error('original_source_header_separator_missing')
 if(end>262144)throw new Error('original_source_headers_too_large')
 const lines=original.slice(0,end).split(/\r?\n/),headers:Record<string,string[]>={}
 let name='',value='',count=0
 const flush=()=>{if(retained.has(name)){if(value.length>16384)throw new Error('original_source_header_too_large');(headers[name]??=[]).push(value.trim())}}
 for(const line of lines){
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(line))throw new Error('original_source_header_invalid')
  if(/^[ \t]/.test(line)){if(!name)throw new Error('original_source_header_invalid');value+=' '+line.trim();continue}
  flush();if(++count>1000)throw new Error('original_source_header_count_limit')
  const match=line.match(/^([!-9;-~]+):[ \t]*(.*)$/)
  if(!match)throw new Error('original_source_header_invalid')
  name=match[1].toLowerCase();value=match[2]
 }
 flush();return headers
}
