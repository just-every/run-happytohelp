// The canonical public repository is declared once, in package.json "repository". The site links to it and its licence
// there, and to its documentation at /docs, which is built from the repository's Markdown (docs/site.json).
import { repository } from '../../../package.json';
import { domain } from '../../../deploy-demo.json';

export const sourceUrl = repository.url;
export const docsUrl = '/docs';
export const installerUrl = '/docs/install';
export const licenseUrl = `${sourceUrl}/blob/main/LICENSE`;
// The hosted demo (DEMO.md "Hosting the demo"), redeployed at each release.
export const demoUrl = `https://demo.${domain}`;
