import { SiteFooter } from '../homepage/SiteFooter';
import { SiteHeader } from '../homepage/SiteHeader';
import { DocsArticle } from './DocsArticle';
import { DocsMenu } from './DocsMenu';
import { DocsPager } from './DocsPager';
import { DocsSidebar } from './DocsSidebar';
import { DocsToc } from './DocsToc';
import { assignTitleStrokes } from './title-strokes';
import type { DocsView } from './types';
import { useCurrentDocs } from './useCurrentDocs';
import '../homepage/outfit.css';
import '../homepage/brand-tokens.css';
import '../homepage/homepage.css';
import '../homepage/drawings.css';
import './docs.css';

/** A documentation page in the homepage's own header, footer, paper, ink and type. */
export function DocsPage({ page, sections, repository, version }: DocsView) {
  useCurrentDocs(version);
  const order = sections.flatMap(section => section.pages.map(entry => ({ ...entry, section: section.title })));
  const index = order.findIndex(entry => entry.slug === page.slug);
  const current = order[index] ?? { label: page.title, section: 'Start here' };
  const strokes = assignTitleStrokes(sections);
  const stroke = strokes.get(page.slug) ?? strokes.get('getting-started')!;
  return <div className="h2h-home h2h-docs">
    <a className="skip-link" href="#docs-content">Skip to the content</a>
    <SiteHeader home="/" current="docs" />
    <div className="docs-shell">
      <DocsSidebar sections={sections} current={page.slug} />
      <main id="docs-content" tabIndex={-1} className="docs-main">
        <DocsMenu sections={sections} current={page.slug} label={current.label} />
        <DocsArticle page={page} section={current.section} stroke={stroke} />
        <DocsPager previous={order[index - 1]} next={order[index + 1]} editUrl={`${repository.url}/edit/${repository.branch}/${page.source}`} />
      </main>
      <DocsToc toc={page.toc} />
    </div>
    <SiteFooter home="/" />
  </div>;
}
