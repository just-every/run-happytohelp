/** Zendesk Help Center articles import through Move in's Zendesk connection, with its audience check. */
export type ImportPlatform='intercom'|'freshdesk'
export async function htmlToMarkdown(html:string){
 const rewritten=new HTMLRewriter().on('script,style,img,iframe,object', {element(e){e.remove()}}).on('h1,h2,h3,h4,h5,h6',{element(e){e.prepend('\n'+'#'.repeat(Number(e.tagName[1]))+' ');e.append('\n\n');e.removeAndKeepContent()}}).on('p,div,section,article,ul,ol',{element(e){e.prepend('\n');e.append('\n');e.removeAndKeepContent()}}).on('li',{element(e){e.prepend('\n- ');e.removeAndKeepContent()}}).on('br',{element(e){e.replace('\n')}}).on('a',{element(e){const href=e.getAttribute('href');if(href&&/^https?:\/\//i.test(href)){e.prepend('[');e.append(`](${href})`)}e.removeAndKeepContent()}}).on('strong,b',{element(e){e.prepend('**');e.append('**');e.removeAndKeepContent()}}).on('em,i',{element(e){e.prepend('*');e.append('*');e.removeAndKeepContent()}}).on('code',{element(e){e.prepend('`');e.append('`');e.removeAndKeepContent()}}).on('*',{element(e){e.removeAndKeepContent()}});
 return (await rewritten.transform(new Response(html)).text()).replace(/\n{3,}/g,'\n\n').trim()
}
