import type {Env} from '../../platform/env'

export const reserved=new Set(['api','auth','health','setup','login','logout','projects','conversations','contacts','contact','settings','dashboard','marketing','features','resources','company','pricing','waitlist','demo','help','portal','docs','run','contract','site-assets','widget.js','_serverFn'])

export async function isPublicSitePath(path: string, env: Env) {
 if (path==='/contact'||path.startsWith('/portal/') || path.startsWith('/help/') || path.startsWith('/api/public-site/')) return true
 const parts = path.split('/').filter(Boolean)
 if (!parts.length || parts.length > 2 || reserved.has(parts[0])) return false
 let key: string
 try { key = decodeURIComponent(parts[0]) } catch { return false }
 return Boolean(await env.DB.prepare('SELECT 1 FROM projects p LEFT JOIN public_project_aliases a ON a.project_id=p.id WHERE p.id=? OR a.slug=? LIMIT 1').bind(key,key).first())
}
