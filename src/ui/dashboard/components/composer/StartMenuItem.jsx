import React from 'react';
import PropTypes from 'prop-types';
import Dropdown from 'react-bootstrap/Dropdown';

/** A captioned group of the "+" start menu. The caption is drawn; the group carries the same name for assistive tech. */
export function StartMenuGroup({ label, children }) {
    const items = React.Children.toArray(children).filter(Boolean);
    if (!items.length) return null;
    return <div className="start-menu__group" role="group" aria-label={ label }>
        <div className="start-menu__caption" aria-hidden="true">{ label }</div>
        { items }
    </div>;
}

StartMenuGroup.propTypes = {
    label: PropTypes.string.isRequired,
    children: PropTypes.node,
};

/**
 * One start menu row: a Feather icon and its words. A row the role may not use is simply not rendered, as today.
 * `checked` makes it a toggle (Follow / Following); `dialog` says the row opens a dialog.
 */
export function StartMenuItem({ icon, children, onSelect, disabled = false, checked, dialog = false }) {
    const toggle = checked !== undefined;
    return <Dropdown.Item
        as="button"
        type="button"
        role={ toggle ? 'menuitemcheckbox' : 'menuitem' }
        aria-checked={ toggle ? Boolean(checked) : undefined }
        aria-haspopup={ dialog ? 'dialog' : undefined }
        className="start-menu__item"
        onClick={ onSelect }
        disabled={ disabled }>
        <i className={ `fe fe-${ icon }` } aria-hidden="true" />
        <span className="start-menu__label">{ children }</span>
    </Dropdown.Item>;
}

StartMenuItem.propTypes = {
    icon: PropTypes.string.isRequired,
    children: PropTypes.node.isRequired,
    onSelect: PropTypes.func,
    disabled: PropTypes.bool,
    checked: PropTypes.bool,
    dialog: PropTypes.bool,
};
