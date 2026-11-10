import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {requireActor} from '../../platform/auth'
import {accessReaders,activeProjectSql,visibleArticleSql} from '../knowledge/door'
import {resolveHelpAccess} from '../knowledge/access'
import {mediaResponseHeaders} from '../conversations/media-response'

/** The native door of imported legacy files that have no conversation (migration 321, media-index.ts):
 * `/api/imported-files/<workspace>/<legacy media id>`. A public file (a logo, an avatar, the widget background) is
 * served to anyone while its workspace is active, so the widget shows it on the customer's own site. An article file
 * is served to the workspace's members, and to whoever may read a published article whose text holds its URL
 * (knowledge/door.ts readers, as the Help Center and its public JSON read them); a draft's file is not served to anyone
 * else. Its bytes are read from R2 each time: a file an erasure or the seed removed answers 404. */
export const importedFiles=new Hono<AppEnv>()

/** Whether `text` holds `url` as a whole URL: what follows it cannot continue a path segment. */
const holds=(text:string,url:string)=>{for(let at=text.indexOf(url);at>=0;at=text.indexOf(url,at+1))if(!/[A-Za-z0-9%._~-]/.test(text[at+url.length]??''))return true;return false}

async function member(c:any,projectId:string){
 if(!c.req.header('Authorization')&&!/(?:^|;\s*)h2h_session=/.test(c.req.header('Cookie')||''))return false
 try{const actor=await requireActor(c);return actor.role!=='contact'&&actor.projectId===projectId}catch{return false}
}

importedFiles.get('/:projectId/:mediaId',async c=>{
 const projectId=c.req.param('projectId'),mediaId=c.req.param('mediaId')
 const file=await c.env.DB.prepare(`SELECT f.* FROM legacy_import_files f WHERE f.project_id=? AND f.media_id=? AND ${activeProjectSql('f.project_id')}`).bind(projectId,mediaId).first<{object_key:string;content_type:string;filename:string;audience:string}>()
 if(!file)throw new HTTPException(404)
 if(file.audience!=='public'&&!await member(c,projectId)){
  const url=`/api/imported-files/${encodeURIComponent(projectId)}/${encodeURIComponent(mediaId)}`
  const readers=accessReaders(await resolveHelpAccess(c.env,projectId,c.req.raw))
  const articles=(await c.env.DB.prepare(`SELECT a.content FROM knowledge_articles a WHERE a.project_id=? AND instr(a.content,?)>0 AND ${visibleArticleSql('a',readers)}`).bind(projectId,url).all<{content:string}>()).results
  if(!articles.some(article=>holds(article.content,url)))throw new HTTPException(404)
 }
 const object=await c.env.FILES.get(file.object_key)
 if(!object)throw new HTTPException(404)
 return new Response(object.body,{headers:{...mediaResponseHeaders(file.content_type,file.filename),'Cache-Control':file.audience==='public'?'public,max-age=300':'private,no-store'}})
})
