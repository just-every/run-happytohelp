import React, { useContext } from 'react';
import PropTypes from 'prop-types';
import initialsFromName from 'initials';
import { ChatContext } from "../contexts/ChatContext";

import '../styles/components/Avatar.scss';
import { tooltip } from '../../../modules/tooltip/tooltip';

function Avatar({ name, initials, className, url, icon, href, label, style, projectId, variant }) {
    // The avatar background is a per-project widget setting. Prefer an explicitly passed
    // project (conversation lists mix projects), then the open conversation's project,
    // then the single-project page's global settings.
    const { getProject, activeProjectId } = useContext(ChatContext);
    const avatarBackground = () => {
        const fromProject = getProject
            ? getProject(projectId || activeProjectId).widgetSettings
            : null;

        return fromProject?.theme?.avatar?.background
            ?? window.chatSettings?.widgetSettings?.theme?.avatar?.background;
    };

    let classes = ['avatar rounded-circle bg-white', url ? 'avatar-photo' : 'avatar-fallback'];
    if (variant) {
        classes.push(`avatar-${ variant }`);
    }

    if (className instanceof  Array) {
        classes.push(...className);
    } else if (className) {
        classes.push(className);
    }

    if (initials === undefined) {
        initials = (name.split(' ').length > 1)
            ? initialsFromName(name).toUpperCase()
            : name.substring(0, 2).toUpperCase();
    }

    style = style || {};
    if(url) {
        const background = avatarBackground();
        if (background) {
            style.background = background;
        }
    }

    const avatar = url
        ? <img src={ url } alt={ name } className="avatar-img rounded-circle" style={ style } crossOrigin="anonymous" />
        : <span className={"avatar-title rounded-circle"+(icon ? " has-icon" : "")} style={ style }>{ icon ? React.cloneElement(icon, { 'aria-hidden': true }) : <span>{ initials } </span> }</span>;

    return href
        ? <a href={ href } className={ classes.join(' ') } { ...tooltip(label || name) }>{ avatar }</a>
        : <div className={ classes.join(' ') } role={ icon ? 'img' : undefined } aria-label={ icon ? name : undefined }>{ avatar }</div>;
}

Avatar.propTypes = {
    name: PropTypes.oneOfType([PropTypes.string, PropTypes.array]),
    className: PropTypes.oneOfType([PropTypes.string, PropTypes.array]),
    url: PropTypes.string,
    icon: PropTypes.object,
    href: PropTypes.string,
    style: PropTypes.object,
    projectId: PropTypes.string,
    variant: PropTypes.string,
};

export default Avatar;
