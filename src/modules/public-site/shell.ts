import { escapeHtml as e } from './html'
import {contrastInk,readableAccentOnWhite} from '../widget/appearance.js'
import { platformIcons, platformLockup } from './platform-brand'
export type PublicBrand = {name:string;color:string;logo_url:string;avatar_url:string;greeting:string;linkColor?:string}
export type HelpProject = {id?:string;name:string;brand?:PublicBrand}

type ShellOptions = {
 /** Search box value; ignored when `search` is false. */
 keyword?: string
 /** The search form needs a project to search; a page with no known project omits it. */
 search?: boolean
 /** Replaces the default "<project> Help Center" document title. */
 title?: string
 noindex?: boolean
 greeting?: boolean
 /** The page belongs to HappyToHelp, not a project: its lockup and tab icons stand in for a project's brand. */
 platform?: boolean
 locale?: string
 defaultLocale?: string
 tools?: string
}

/** The Help Center document frame: header, brand, search and content column. `base` is the project's help URL, or `/` when no project is known. */
export function shell(project: HelpProject, base: string, content: string, { keyword = '', search = true, title, noindex = false, greeting = false, platform = false, locale = 'en', defaultLocale = 'en', tools = '' }: ShellOptions = {}) {
 const brand=project.brand, name=brand?.name||project.name
 const linkColor=brand?.linkColor||(brand?.color?readableAccentOnWhite(brand.color):'')
 const accent=(brand?.color||linkColor)?` style="${brand?.color?`--help-center-nav:${e(brand.color)};--help-center-brand-ink:${contrastInk(brand.color)};`:''}--help-center-link:${e(linkColor)};--help-center-link-hover:${e(linkColor)}"`:''
 const logo=brand?.logo_url?`<img class="help-center-logo" src="${e(brand.logo_url)}" alt="">`:''
 const welcome=greeting&&(brand?.greeting||brand?.avatar_url)?`<div class="help-center-welcome">${brand.avatar_url?`<img src="${e(brand.avatar_url)}" alt="${e(name)} support">`:''}${brand.greeting?`<p>${e(brand.greeting)}</p>`:''}</div>`:''
 const brandLabel=platform?`${platformLockup}<span><strong class="help-center-sr">HappyToHelp</strong> Help Center</span>`:`${logo}<span><strong>${e(name)}</strong> Help Center</span>`
 const languageQuery=locale===defaultLocale?'':`?locale=${encodeURIComponent(locale)}`
 const searchForm = search ? `<form class="help-center-search" action="${base}/search" role="search">${locale!==defaultLocale?`<input type="hidden" name="locale" value="${e(locale)}">`:''}<input type="search" placeholder="Search the Help Center" value="${e(keyword)}" aria-label="Search the Help Center" name="keyword"><button type="submit">Search</button></form>` : ''
 return `<!doctype html><html lang="${e(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${noindex ? '<meta name="robots" content="noindex">' : ''}<title>${e(title ?? `${project.name} Help Center`)}</title><link rel="stylesheet" href="/site-assets/help_center/css/app.css"><link rel="stylesheet" href="/site-assets/help_center/experience.css">${platform ? platformIcons : ''}</head><body${accent} data-help-base="${e(base || '/')}"${project.id?` data-help-project="${e(project.id)}"`:''}><nav class="help-center-nav" data-help-center-nav aria-label="Help Center navigation"><div class="help-center-nav-inner"><a class="help-center-brand" href="${base || '/'}${languageQuery}">${brandLabel}</a>${searchForm}</div></nav><div class="help-center-status" data-help-status role="status" hidden></div><main class="help-center-main"><div class="help-center-content">${tools}${welcome}${content}</div></main><script src="/site-assets/help_center/navigation.js" defer></script></body></html>`
}
