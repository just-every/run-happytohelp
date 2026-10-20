import { SearchField } from '../../site/docs-search/SearchField';
import { HydrationUnit } from '../../vendor/base/hydration/unit';
import { DocsNavList } from './DocsNavList';
import type { DocsSection } from './types';

/** The section navigation on phones and narrow windows: one pill that opens the full list. */
export function DocsMenu({ sections, current, label, search }: { sections: DocsSection[]; current: string; label: string; search?: boolean }) {
  return <HydrationUnit><nav className="docs-menu" aria-label="Documentation">
    <details>
      <summary>Docs menu <span className="docs-menu-current">· {label}</span></summary>
      <div className="docs-menu-list">{search && <SearchField id="docs-menu-search" />}
    <DocsNavList sections={sections} current={current} idPrefix="docs-menu" /></div>
    </details>
  </nav></HydrationUnit>;
}
