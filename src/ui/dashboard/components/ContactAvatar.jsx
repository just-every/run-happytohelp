import React from 'react';
import PropTypes from 'prop-types';
import Avatar from "./Avatar";
import { contrast, darken } from 'khroma';
import {
    ContactProfileSymbol,
    getNicknameShape,
    resolveContactNicknameColor,
    resolveContactProfilePaletteForContact,
    resolveContactProfileSymbol,
} from './avatar-symbols';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowUp, faAtom, faBaseballBall, faBell, faBroom, faCaretUp, faCarrot, faCat, faCircle, faCookie, faCrow, faCube, faDiamond, faDice, faDog, faDove, faEgg, faEye, faFeather, faFish, faHeart, faHippo, faHorse, faHotdog, faLeaf, faMeteor, faMinus, faMoon, faPaw, faPencilAlt, faPizzaSlice, faRocket, faScrewdriver, faSeedling, faShieldAlt, faSquare, faStar, faStop, faSun, faTicketAlt, faTimes, faWindowMaximize, faWrench } from '@fortawesome/free-solid-svg-icons';

const shapes = {
    'octagon': faStop, 'hexagon': faCube, 'rhombus': faDiamond, 'triangle': faCaretUp, 'square': faSquare, 'rectangle': faWindowMaximize, 'pentagon': faCube, 'circle': faCircle, 'oval': faCircle, 'star': faStar, 'arrow': faArrowUp, 'cross': faTimes, 'line': faMinus, // shapes
    'spade': faLeaf, 'club': faLeaf, 'heart': faHeart, 'diamond': faDiamond, // cards
    'carrot': faCarrot, 'burrito': faHotdog, 'cookie': faCookie, 'egg': faEgg, 'corn': faSeedling, 'pizza': faPizzaSlice, // food
    'atom': faAtom, 'comet': faMeteor, 'galaxy': faAtom, 'moon': faMoon, 'starship': faRocket, 'sun': faSun, 'rocket': faRocket,
    'bat': faCrow, 'cat': faCat, 'dog': faDog, 'dove': faDove, 'duck': faDove, 'fish': faFish, 'feather': faFeather, 'elephant': faPaw, 'sheep': faPaw, 'hippo': faHippo, 'unicorn': faHorse, // animals
    'ball': faBaseballBall, 'broom': faBroom, 'dice': faDice, 'flower': faSeedling, 'leaf': faLeaf, 'ticket': faTicketAlt, 'tire': faCircle, 'wrench': faWrench, 'pencil': faPencilAlt, 'screwdriver': faScrewdriver, 'bell': faBell, 'shield': faShieldAlt, 'eye': faEye, // objects
};

// Given a string, out a stable number in a given range.
// i.e. for the same string, the number should always be the same
// If the string is too short the full range may not be covered
let stringToStableNumber = (str, min, max) => {
    let rotation = 0;
    for(let i = 0; i < str.length; ++i) {
        rotation += str.charCodeAt(i);
    }
    rotation = (rotation % (max - min)) + min;
    return rotation;
};

function ContactAvatar({ contact, className, href, label, projectId, presentation = 'default' }) {
    const avatarClasses = [ className, contact.is_online && 'avatar-online' ].filter(Boolean);

    let icon, iconStyle = {}, style = {};
    if (!contact.avatar_url && contact.nickname) {
        const { name: colorName, color: identityColor, shape: shapeName } = resolveContactNicknameColor(contact.nickname);

        if(identityColor) {
            style.color = identityColor;
            style['--avatar-identity-color'] = identityColor;
            style.background = identityColor+'1A';
            style.borderColor = identityColor+'40';
        }

        let colorContrast = contrast(style.color, '#ffffff');
        if(colorContrast < 1.1) {
            // For almost white, add line around the icon and darken background
            style.background = darken(style.color, 2);
            style.borderColor = darken(style.color, 10);
            if(contact.display_name !== contact.nickname) {
                style.color = darken(style.color, 45);
            }
            else {
                iconStyle = {filter: 'drop-shadow('+darken(style.color, 45)+' 0px 0px 1px)'};
                style.color = '#ffffff';
            }
        }
        else if(colorName !== 'aquamarine' && colorContrast < 1.25) {
            // For very light colors set the background to the color and darken the color and border
            style.background = style.color;
            style.borderColor = darken(style.color, 15);
            style.color = darken(style.color, 25);
        }
        else if(colorName === 'thistle' || colorContrast < 1.35) {
            // For moderately light colors just darken the color a little
            style.borderColor = style.color;
            style.color = darken(style.color, 5);
        }

        if(style.borderColor) {
            // @todo remove this stupid hack and compute it properly at the top of the tree :)
            contact.lineColor = style.borderColor;
        }

        if(contact.display_name === contact.nickname && shapes[shapeName]) {
            icon = <FontAwesomeIcon icon={ shapes[shapeName] }  transform={{ rotate: stringToStableNumber(contact.id, -45, 45) }} style={ iconStyle } />;
        }
    }

    // The inbox profile presentation replaces only contact fallbacks. Real profile
    // photos always win, while the default presentation keeps the existing initials
    // and anonymous-shape behaviour everywhere else.
    const resolvedProfileSymbol = presentation === 'conversation-profile' && !contact.avatar_url
        ? resolveContactProfileSymbol(contact)
        : null;
    const useProfileSymbol = Boolean(resolvedProfileSymbol);
    if (useProfileSymbol) {
        const nicknameShape = getNicknameShape(contact.nickname);
        const hasKnownNicknameShape = Boolean(nicknameShape && shapes[nicknameShape]);

        icon = <ContactProfileSymbol name={ resolvedProfileSymbol } />;
        avatarClasses.push('avatar-contact-symbol', `avatar-contact-symbol-${ resolvedProfileSymbol }`);
        const palette = resolveContactProfilePaletteForContact(contact, style['--avatar-identity-color']);
        style['--contact-profile-symbol-tile'] = palette.tile;
        style['--contact-profile-symbol-ink'] = palette.ink;

        // Preserve the visible rotation cue for explicit anonymous nickname shapes.
        // The new outlines are intentionally not rotated for named contacts, which
        // are deterministically diversified from their contact id instead.
        if (hasKnownNicknameShape && contact.display_name === contact.nickname) {
            style['--contact-profile-symbol-rotation'] = `${ stringToStableNumber(contact.id, -12, 12) }deg`;
        }
    }

    return <Avatar
        name={ contact.display_name }
        initials={ contact.initials }
        className={ avatarClasses }
        url={ contact.avatar_url }
        icon={ icon }
        href={ href }
        label={ label }
        style={ style }
        projectId={ projectId }
        variant={ useProfileSymbol ? 'contact-symbol' : (icon ? 'contact-anonymous' : 'contact') }
    />;
}

ContactAvatar.propTypes = {
    contact: PropTypes.object,
    className: PropTypes.string,
    href: PropTypes.string,
    label: PropTypes.string,
    projectId: PropTypes.string,
    presentation: PropTypes.oneOf(['default', 'conversation-profile']),
};

export default ContactAvatar;
