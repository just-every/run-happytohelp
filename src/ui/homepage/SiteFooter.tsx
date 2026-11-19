import { HydrationUnit } from '../../vendor/base/hydration/unit';
import { BrandLockup } from './BrandLockup';
import { docsUrl, licenseUrl, sourceUrl } from './repository';

export function SiteFooter({ home = '#top' }: { home?: string }) {
  return <HydrationUnit><footer className="site-footer">
    <BrandLockup home={home} />
    <nav aria-label="Footer navigation">
      <a href={docsUrl}>Docs</a><a href={sourceUrl}>GitHub</a>
      <a href="/projects">Workspace</a><a href="/setup">Set up</a><a href="/login">Log in</a>
      <a className="pill pill--outline" href={licenseUrl}>MIT licence</a>
    </nav>
  </footer></HydrationUnit>;
}
