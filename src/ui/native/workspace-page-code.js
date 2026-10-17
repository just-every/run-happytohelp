import { lazyPageCode } from './lazy-page-code';

const pages = {
    Connections: lazyPageCode(() => import('./pages/Connections')),
    Reports: lazyPageCode(() => import('./pages/surveys/ReportsWithSurveys')),
    MoveIn: lazyPageCode(() => import('./pages/MoveIn')),
    ActivationPage: lazyPageCode(() => import('./activation/ActivationPage')),
    SetupTitle: lazyPageCode(() => import('./activation/SetupTitle')),
    GitHubSettings: lazyPageCode(() => import('./pages/GitHubSettings')),
    ArticleImport: lazyPageCode(() => import('./pages/ArticleImport')),
    ProjectsPage: lazyPageCode(() => import('./pages/ProjectsPage')),
    AdminPage: lazyPageCode(() => import('./pages/AdminPage')),
    KnowledgePage: lazyPageCode(() => import('./pages/KnowledgePage')),
    ManagementPage: lazyPageCode(() => import('./pages/ManagementPage')),
    ProjectSettings: lazyPageCode(() => import('./pages/ProjectSettings')),
    WidgetSettingsPage: lazyPageCode(() => import('./pages/WidgetSettingsPage')),
    ComputersPage: lazyPageCode(() => import('./pages/ComputersPage')),
    DelegationSettings: lazyPageCode(() => import('./pages/DelegationSettings')),
    DelegationAuthorize: lazyPageCode(() => import('./pages/DelegationAuthorize')),
    TrainingRuns: lazyPageCode(() => import('./pages/TrainingRuns')),
    AccountPage: lazyPageCode(() => import('./pages/AccountPage')),
    InsightsPage: lazyPageCode(() => import('./pages/InsightsPage')),
    SecurityPage: lazyPageCode(() => import('./pages/security/SecurityPage')),
    SecurityLog: lazyPageCode(() => import('./pages/security/SecurityLog')),
    TicketSettings: lazyPageCode(() => import('./pages/tickets/TicketSettings')),
    SuspendedMail: lazyPageCode(() => import('./pages/SuspendedMail')),
    RolesPage: lazyPageCode(() => import('./pages/security/RolesPage')),
};

export const workspacePageComponents = Object.fromEntries(
    Object.entries(pages).map(([name, page]) => [name, page.Component]),
);

export function workspacePageRoute(pathname, settings = {}) {
    const segments = pathname.split('/').filter(Boolean);
    const section = settings.accountOnly ? 'projects'
        : segments[0] === 'projects' && (!segments[1] || segments[1] === 'create') ? 'projects'
        : segments[0] === 'projects' ? segments[2] || 'edit' : segments[0];
    const recordId = segments[0] === 'projects' ? segments[3] : segments[1];
    return { segments, section, recordId };
}

/** Import only the leaf the workspace will render, alongside its heading when needed. */
export function preloadWorkspacePage(pathname, settings) {
    if (settings?.projectUnavailable) return Promise.resolve();
    const { section, recordId } = workspacePageRoute(pathname, settings);
    let name;
    if (section === 'projects') name = 'ProjectsPage';
    else if (section === 'reports') name = 'Reports';
    else if (section === 'move-in') name = 'MoveIn';
    else if (section === 'activation') return Promise.all([pages.ActivationPage.preload(), pages.SetupTitle.preload()]);
    else if (section === 'articles' && recordId === 'import') name = 'ArticleImport';
    else if (section === 'articles' && recordId) return Promise.all([
        pages.KnowledgePage.preload(),
        import('./pages/knowledge/article-editor-code').then(module => module.preloadArticleEditor()),
    ]);
    else if (['datasets', 'articles', 'categories'].includes(section)) name = 'KnowledgePage';
    else if (['ais', 'macros', 'contacts', 'plugins', 'agents'].includes(section)) name = 'ManagementPage';
    else if (['edit', 'settings', 'email-settings'].includes(section)) name = 'ProjectSettings';
    else if (['api-settings', 'webhook-settings', 'slack-settings', 'delivery-log'].includes(section)) name = 'Connections';
    else if (section === 'github-settings') name = 'GitHubSettings';
    else if (section === 'security') name = 'SecurityPage';
    else if (section === 'security-log') name = 'SecurityLog';
    else if (section === 'ticket-settings') name = 'TicketSettings';
    else if (section === 'suspended') name = 'SuspendedMail';
    else if (section === 'roles') name = 'RolesPage';
    else if (section === 'widget-settings') name = 'WidgetSettingsPage';
    else if (section === 'local-agent') name = 'ComputersPage';
    else if (section === 'delegation') name = recordId === 'authorize' ? 'DelegationAuthorize' : 'DelegationSettings';
    else if (section === 'training-runs') name = 'TrainingRuns';
    else if (section === 'users' && (!settings || recordId === 'profile' || recordId === settings.currentAgent?.id)) name = 'AccountPage';
    else if (section === 'admin' && (!settings || settings.isPlatformAdmin)) name = 'AdminPage';
    else if (section === 'insights') name = 'InsightsPage';
    return name ? pages[name].preload() : Promise.resolve();
}
