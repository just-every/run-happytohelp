export const dashboardPath = /^\/(?:conversations(?:\/[^/]+)?|projects(?:\/create|\/[^/]+(?:\/(?:conversations(?:\/[^/]+)?|activation|move-in|companies|reports|api-settings|webhook-settings|slack-settings|delivery-log|edit|settings|email-settings|suspended|widget-settings|ticket-settings|workflow-settings|github-settings|assurance|security|security-log|roles|local-agent|training-runs(?:\/[^/]+)?|insights(?:\/[^/]+)?|(?:ais|macros|contacts|plugins|agents|datasets|articles|categories)(?:\/[^/]+)?))?)?|local-agent\/authorize|delegation\/(?:authorize|settings)|users\/[^/]+|admin(?:\/[^/]+(?:\/[^/]+)?)?)\/?$/;

// An emailed invitation is the one public page a person signs in to come back to.
const invitationPath = /^\/accept-invitation\/?$/;
// Sign-in returns an owner to first-run setup, which sends them on to their workspace.
const setupPath = /^\/setup\/?$/;

/** Login resumes only a dashboard URL, an invitation link or first-run setup within this application. */
export function loginDestination(returnTo, origin, accountOnly = false) {
    const fallback = accountOnly ? '/projects/create' : '/conversations';
    if (typeof returnTo !== 'string' || !returnTo.startsWith('/') || returnTo.startsWith('//')) return fallback;
    try {
        // URL parsing otherwise silently normalizes backslashes and strips controls.
        if (/[\\\u0000-\u0020\u007f]/.test(returnTo) || /[\\\u0000-\u001f\u007f]/.test(decodeURIComponent(returnTo))) return fallback;
        const target = new URL(returnTo, origin);
        if (target.origin !== origin || !dashboardPath.test(target.pathname) && !invitationPath.test(target.pathname) && !setupPath.test(target.pathname)) return fallback;
        return target.pathname + target.search + target.hash;
    } catch {
        return fallback;
    }
}
