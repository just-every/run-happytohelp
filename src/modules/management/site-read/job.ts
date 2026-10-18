import type {Env, Job} from '../../../platform/env'
import {cronRoom} from '../../../platform/cron-budget'
import {publicOrigin, SiteFetcher, SiteReadStop} from './fetch'
import {homeLinks, MAX_HELP_PAGES, pageToDocument, rankHelpLinks, siteColour, siteName, sitemapLocations, type SitePage} from './parse'
import {allowAll, parseRobots, type Robots} from './robots'
import {writeSiteSource} from './source'
import {applySiteIdentity, claimRead, finishRead, type SiteReadRecord} from './state'

const READ_BUDGET_MS = 90_000
/** A read that has been `running` longer than this is not coming back; it is marked uncertain and never repeated. */
export const STALE_RUNNING_MS = 5 * 60_000
const LOST_QUEUE_MS = 5 * 60_000
const GIVE_UP_MS = 24 * 3_600_000

const HOME_MAX = 512_000
const PAGE_MAX = 512_000
const SITEMAP_MAX = 256_000
const ROBOTS_MAX = 64_000

const isHtml = (type: string) => type.includes('text/html') || type.includes('application/xhtml')

async function robotsFor(fetcher: SiteFetcher): Promise<Robots> {
 const robots = await fetcher.get('/robots.txt', {max: ROBOTS_MAX, accept: 'text/plain,*/*;q=0.5'})
 if (robots.status >= 500) throw new SiteReadStop('failed', 'robots_unavailable')
 return robots.status >= 400 ? allowAll : parseRobots(robots.text)
}

interface Reading {name: string | null; colour: string | null; origin: string; pages: SitePage[]}

async function readSite(env: Env, projectId: string): Promise<Reading> {
 const project = await env.DB.prepare('SELECT allowed_origin FROM projects WHERE id=?').bind(projectId).first<{allowed_origin: string}>()
 if (!project) throw new SiteReadStop('failed', 'project_missing')
 const fetcher = new SiteFetcher(publicOrigin(project.allowed_origin), Date.now() + READ_BUDGET_MS)
 const robots = await robotsFor(fetcher)
 if (!robots('/')) throw new SiteReadStop('skipped', 'robots_disallowed')
 const home = await fetcher.get('/', {max: HOME_MAX, allow: robots})
 if (home.status !== 200 || !isHtml(home.type)) throw new SiteReadStop('failed', 'home_unreadable')

 let sitemap = ''
 try {
  const found = await fetcher.get('/sitemap.xml', {max: SITEMAP_MAX, allow: robots, accept: 'application/xml,text/xml,*/*;q=0.5'})
  if (found.status === 200) sitemap = found.text
 } catch (error) { if (!(error instanceof SiteReadStop)) throw error }

 const candidates = rankHelpLinks(fetcher.origin, fetcher.origin + '/', [...homeLinks(home.text), ...sitemapLocations(sitemap)], 50)
  .filter(href => { const url = new URL(href); return robots(url.pathname + url.search) })
  .slice(0, MAX_HELP_PAGES)
 const pages: SitePage[] = []
 const titles = new Set<string>()
 for (const href of candidates) {
  let page
  try { page = await fetcher.get(href, {max: PAGE_MAX, allow: robots}) } catch (error) {
   if (!(error instanceof SiteReadStop)) throw error
   if (error.reason === 'budget_exhausted') break
   continue
  }
  if (page.status !== 200 || !isHtml(page.type)) continue
  const document = pageToDocument(href, page.text)
  if (!document || titles.has(document.title.toLowerCase())) continue
  titles.add(document.title.toLowerCase())
  pages.push(document)
 }
 return {name: siteName(home.text), colour: siteColour(home.text), origin: fetcher.origin, pages}
}

/** The `site.read` job. One attempt: the `queued` -> `running` claim is the only way in, and nothing here retries. */
export async function consumeSiteRead(job: Job, env: Env): Promise<boolean> {
 if (job.type !== 'site.read') return false
 const projectId = job.projectId
 if (!await claimRead(env, projectId, Date.now())) return true
 let record: SiteReadRecord
 try {
  const reading = await readSite(env, projectId)
  const pages = await writeSiteSource(env, projectId, reading)
  const applied = await applySiteIdentity(env, projectId, reading, Date.now())
  record = {state: 'done', at: Date.now(), pages, ...applied, ...(pages ? {} : {reason: 'no_help_pages'})}
 } catch (error) {
  if (error instanceof SiteReadStop) record = {state: error.outcome, at: Date.now(), reason: error.reason}
  else {
   console.error('Site read failed', projectId, error instanceof Error ? error.message : String(error))
   record = {state: 'failed', at: Date.now(), reason: 'error'}
  }
 }
 await finishRead(env, projectId, record)
 return true
}

/**
 * Scheduler recovery. A read stuck `running` is marked `uncertain` and is not repeated (a repeat could write the source twice). A read still `queued` after its message should have been delivered is sent again; the claim keeps that
 * harmless. A read that never started in a day is closed as failed.
 */
export async function recoverSiteReads(env: Env): Promise<void> {
 if(!cronRoom(env,3))return
 const now = Date.now()
 const state = "json_extract(settings_json,'$.site_read.state')", at = "json_extract(settings_json,'$.site_read.at')"
 await env.DB.prepare(`UPDATE project_settings SET settings_json=json_set(settings_json,'$.site_read.state','uncertain','$.site_read.reason','interrupted','$.site_read.at',?),updated_at=? WHERE ${state}='running' AND ${at}<?`)
  .bind(now, now, now - STALE_RUNNING_MS).run()
 await env.DB.prepare(`UPDATE project_settings SET settings_json=json_set(settings_json,'$.site_read.state','failed','$.site_read.reason','not_started','$.site_read.at',?),updated_at=? WHERE ${state}='queued' AND ${at}<?`)
  .bind(now, now, now - GIVE_UP_MS).run()
 const lost = await env.DB.prepare(`SELECT project_id FROM project_settings WHERE ${state}='queued' AND ${at}<? AND json_extract(settings_json,'$.deleted_at') IS NULL AND EXISTS(SELECT 1 FROM projects p WHERE p.id=project_settings.project_id) LIMIT 50`).bind(now - LOST_QUEUE_MS).all<{project_id: string}>()
 for (const row of lost.results) await env.JOBS.send({type: 'site.read', id: row.project_id, projectId: row.project_id})
}
