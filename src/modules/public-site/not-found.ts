import { escapeHtml as e } from './html'
import { shell, type HelpProject } from './shell'

/**
 * Help Center 404 pages. The body depends only on the project the URL names, never on why the article is
 * missing, so an unpublished draft is indistinguishable from an article that never existed.
 */
export function missingArticlePage(project: HelpProject, base: string) {
 return shell(project, base, `<h1>Article not found</h1><p class="help-center-notice">We can’t find that article. Restricted collections require an explicit account grant; sharing an email domain does not grant access. It may have been moved, renamed or unpublished. Search the ${e(project.name)} Help Center above, or <a href="${base || '/'}">browse all articles</a>.</p>`, { title: `Article not found · ${project.name} Help Center`, noindex: true })
}

/** No project is known (unknown, deleted or unroutable address): the page is HappyToHelp's, with its brand and no search to offer. */
export function missingHelpCenterPage() {
 return shell({ name: 'HappyToHelp' }, '/', '<h1>Help Center not found</h1><p class="help-center-notice">We can’t find that Help Center. The address may be mistyped, or the Help Center may no longer be published. Check the link you were given, or <a href="/">go to the HappyToHelp homepage</a>.</p>', { search: false, title: 'Help Center not found · HappyToHelp', noindex: true, platform: true })
}
