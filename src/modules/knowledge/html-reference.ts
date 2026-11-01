const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!))
/** Reference bytes are inserted after the enclosing email Markdown was rendered.
 * Escape them at that boundary; a source can never introduce mail markup. */
export function htmlReference(kind:string,payload:{text:string;title?:string;url?:string}){
 if(kind==='link'&&payload.url){try{const url=new URL(payload.url);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)return `<a href="${escape(url.href)}">${escape(payload.title||url.href)}</a>`}catch{}}
 return escape(payload.text).replace(/\r?\n/g,'<br>')
}
