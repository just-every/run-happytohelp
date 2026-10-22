import React from 'react';
import { Link } from '@tanstack/react-router';
import { CountDisc } from './InboxNavigation';
import { useMobileNavigation } from './MobileNavigation';
import { destinationActive, settingsGroups } from './settings-destinations';

/**
 * The rail on a Settings page (and, below 1200px, the menu sheet), under the row back to the inbox: Setup, then every
 * destination under its topic. The current destination carries the rail's highlight; the Settings row below reads as
 * its section. Setup counts what still needs the owner.
 */
export default function SettingsNavigation({ base, projectId, here, setupNeeds }) {
    const { setOpen } = useMobileNavigation();
    const close = () => setOpen(false);
    const entry = destination => {
        const current = destinationActive(here, base, destination);
        const props = { className: `nav-link${ current ? ' is-current' : '' }`, 'aria-current': current ? 'page' : undefined, activeProps: {}, onClick: close };
        const label = <>
            <span className="navbar-link-label">{ destination.label }</span>
            { destination.path === 'activation' && <CountDisc count={ setupNeeds }/> }
        </>;
        return <li key={ destination.label }>{ destination.absolute
            ? <Link to={ destination.absolute } search={ { account_id: projectId } } { ...props }>{ label }</Link>
            : <Link to={ `${ base }/${ destination.path }` } { ...props }>{ label }</Link> }</li>;
    };
    return <li className="nav-item"><nav className="nav-settings-group" data-testid="settings-menu" aria-label="Settings">
        { settingsGroups.map((group, index) => <React.Fragment key={ group.label ?? index }>
            { group.label && <p className="nav-settings-caption" id={ `settings-group-${ index }` }>{ group.label }</p> }
            <ul aria-labelledby={ group.label ? `settings-group-${ index }` : undefined }>{ group.destinations.map(entry) }</ul>
        </React.Fragment>) }
    </nav></li>;
}

/** Below 1200px the Settings menu is in the menu sheet: this pill above a Settings page's title opens it there, with
 *  focus on the current destination, as the inbox's list title opens the views. */
export function SettingsMenuButton({ title }) {
    const { open, setOpen } = useMobileNavigation();
    const show = () => {
        setOpen(true);
        requestAnimationFrame(() => document.querySelector('[data-testid="settings-menu"] .is-current')?.focus());
    };
    return <button type="button" className="settings-menu-button d-xl-none" aria-label={ `${ title }, show settings` } aria-controls="sidebarCollapse" aria-expanded={ open } onClick={ show }>
        <i className="fe fe-settings" aria-hidden="true"/><span>Settings</span><i className="fe fe-chevron-down" aria-hidden="true"/>
    </button>;
}
