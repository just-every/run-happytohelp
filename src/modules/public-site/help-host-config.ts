import type { Env } from '../../platform/env'

/** Deployment configuration only: no suffix inference, workspace domain setting or forwarded header lookup. */
export function configuredHelpProject(request: Request, env: Env): string | null {
 if (typeof env.PUBLIC_HELP_HOSTS !== 'string' || !env.PUBLIC_HELP_HOSTS.trim()) return null
 let hosts: unknown
 try { hosts = JSON.parse(env.PUBLIC_HELP_HOSTS) } catch { return null }
 if (!hosts || typeof hosts !== 'object' || Array.isArray(hosts)) return null
 const hostname = new URL(request.url).hostname
 // An installation's ordinary public homepage and Run entry always retain their own routing.
 if (typeof env.APP_ORIGIN === 'string') {
  try { if (new URL(env.APP_ORIGIN).hostname === hostname) return null } catch { return null }
 }
 if (!Object.hasOwn(hosts, hostname)) return null
 const project = (hosts as Record<string, unknown>)[hostname]
 return typeof project === 'string' && project.trim() === project && project.length > 0 && project.length <= 200 ? project : null
}
