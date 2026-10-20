import { Divider, dividerLines } from './Divider';
import { Free } from './Free';
import { GetStarted } from './GetStarted';
import { Hero } from './Hero';
import { MoveIn } from './MoveIn';
import { Product } from './Product';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import './outfit.css';
import './brand-tokens.css';
import './homepage.css';
import './drawings.css';
import './hero-story.css';
import './section-drawings.css';
import './motion.css';

export default function Homepage() {
  return <div className="h2h-home">
    <a className="skip-link" href="#product">Skip to the product</a>
    <SiteHeader />
    <main><Hero /><Free /><Divider line={dividerLines.first} /><Product /><Divider line={dividerLines.second} /><MoveIn /><GetStarted /></main>
    <SiteFooter />
  </div>;
}
