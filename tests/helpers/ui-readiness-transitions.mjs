import assert from 'node:assert/strict';
import {contrastRatio} from './accessibility-contrast.mjs';

// Read each rendered frame rather than waiting for transitions to settle.
export function installReadinessSampler() {
    window.readinessFrames = [];
    window.stopReadinessSampling = false;
    const selectors = ['.navbar-link-label', '#sidebar .nav-link.active', '#sidebar .nav-link.is-current', '.native-account-dropdown .dropdown-item', '#widget-settings-tabs-tab-theme', '.tab-pane.active label', '.modal label', '.modal textarea', '.modal .btn'];
    const sample = () => {
        for (const selector of selectors) for (const element of document.querySelectorAll(selector)) {
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight) continue;
            let opacity = 1, background;
            const ancestors = [];
            for (let node = element; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                opacity *= Number(style.opacity);
                ancestors.push({node: node.tagName + '#' + node.id + '.' + node.className, opacity: style.opacity, transition: style.transition, animation: style.animation, transform: style.transform});
                if (!background && style.backgroundColor !== 'rgba(0, 0, 0, 0)') background = style.backgroundColor;
            }
            window.readinessFrames.push({selector, text: element.textContent.trim(), foreground: getComputedStyle(element).color, background: background || 'rgb(255, 255, 255)', opacity, width: rect.width, height: rect.height, ancestors});
        }
        if (!window.stopReadinessSampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
}

export function assertReadinessFrames(frames) {
    assert.ok(frames.length > 0, 'rendered transition frames captured');
    for (const frame of frames) {
        assert.equal(frame.opacity, 1, `${frame.selector} keeps full ancestor opacity`);
        const ratio = contrastRatio(frame.foreground, frame.background);
        assert.ok(ratio >= 4.5, `${frame.selector} ${frame.text} frame contrast ${ratio}: ${frame.foreground} on ${frame.background}`);
        if (frame.selector.includes('dropdown-item')) {
            assert.ok(frame.width >= 24 && frame.height >= 24, 'menu targets keep their hit area from their first frame');
        }
        if (frame.selector.startsWith('.modal')) {
            assert.ok(frame.ancestors.every(ancestor => ancestor.transform === 'none'), 'dialog targets stay in their final position from their first frame');
            if (frame.selector === '.modal .btn') assert.ok(frame.width >= 24 && frame.height >= 24, 'dialog buttons keep their hit area');
        }
    }
}
