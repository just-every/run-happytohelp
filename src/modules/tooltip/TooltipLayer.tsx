import { useEffect } from 'react';
import { installTooltips } from './tooltip';
import './tooltip.css';

/** Shows the tooltips of every control marked by tooltip() in the page while mounted. Render it once, near the root. */
export function TooltipLayer() {
    useEffect(() => installTooltips(document), []);
    return null;
}
