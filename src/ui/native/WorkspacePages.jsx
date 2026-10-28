import React from 'react';
import { SettingsMenuButton } from './SettingsNavigation';
import { onSettingsDestination } from './settings-destinations';
import { Link } from '@tanstack/react-router';
import { useDashboardLocation } from './dashboard-state';
import { adminTitles } from './pages/AdminRecords';
import { workspacePageComponents, workspacePageRoute } from './workspace-page-code';
import { AdminRequired, PageNotFound, ProjectUnavailable } from './pages/WorkspaceNotices';
const titles={'support-channels':'Support channels','hubspot-settings':'HubSpot',procedures:'Procedures',companies:'Companies','workflow-settings':'Workflows','ticket-settings':'Tickets','api-settings':'API tokens','webhook-settings':'Webhooks','slack-settings':'Slack','delivery-log':'Delivery log',reports:'Reports','move-in':'Move in',edit:'Project',settings:'Project',ais:'AI',datasets:'Knowledge',articles:'Knowledge',categories:'Knowledge',agents:'Agents','local-agent':'Local computers','email-settings':'Email',suspended:'Suspended email','widget-settings':'Widget',macros:'Saved Replies',contacts:'Contacts',plugins:'Plugins',users:'Profile',insights:'Insights','training-runs':'Evaluation runs',security:'Security','security-log':'Security log',roles:'Roles'};
export default function WorkspacePages({ settings, pages = {} }) {
    const { ChannelSettings, Connections, Reports, Companies, MoveIn, ActivationPage, SetupTitle, GitHubSettings, ArticleImport,
        ProjectsPage, AdminPage, KnowledgePage, ManagementPage, ProjectSettings, WidgetSettingsPage,
        ComputersPage, DelegationSettings, DelegationAuthorize, ProcedureSettings, TrainingRuns, AccountPage, InsightsPage, SecurityPage, SecurityLog, RolesPage, TicketSettings, SuspendedMail, WorkflowSettings } = { ...workspacePageComponents, ...pages };
    const pathname = useDashboardLocation().pathname;
    const {segments,section,recordId}=workspacePageRoute(pathname,settings);
    const projectId=segments[0]==='projects'?segments[1]:settings.project?.id||Object.keys(settings.projects||{})[0];
    // /users/<id> is only the signed-in user's own profile; any other id is not a page.
    const foreignUser=section==='users'&&recordId!=='profile'&&recordId!==settings.currentAgent?.id;
    let page;
    if(settings.projectUnavailable)page=<ProjectUnavailable/>;
    else if(section==='projects')page=<ProjectsPage/>;
    else if(section==='reports')page=<Reports projectId={projectId}/>;
    else if(section==='companies')page=<Companies projectId={projectId} role={settings.projects?.[projectId]?.role}/>;
    else if(section==='move-in')page=<MoveIn projectId={projectId}/>;
    else if(section==='activation')page=<ActivationPage projectId={projectId} role={settings.projects?.[projectId]?.role}/>;
    else if(section==='articles'&&recordId==='import')page=<ArticleImport {...{projectId}}/>;
    else if(['datasets','articles','categories'].includes(section))page=<KnowledgePage {...{projectId,section,recordId}} project={settings.projects?.[projectId]||settings.project}/>;
    else if(['ais','macros','contacts','plugins','agents'].includes(section))page=<ManagementPage {...{projectId,section,recordId}}/>;
    else if(['edit','settings','email-settings'].includes(section))page=<ProjectSettings {...{projectId,section}} role={settings.projects?.[projectId]?.role}/>;
    else if(['hubspot-settings','api-settings','webhook-settings','slack-settings','delivery-log'].includes(section))page=<Connections {...{projectId,section}} role={settings.projects?.[projectId]?.role}/>;
    else if(section==='support-channels')page=<ChannelSettings key={projectId} {...{projectId}} role={settings.projects?.[projectId]?.role}/>;
    else if(section==='github-settings')page=<GitHubSettings {...{projectId}}/>;
    else if(section==='security')page=<SecurityPage {...{projectId}} role={settings.projects?.[projectId]?.role}/>;
    else if(section==='security-log')page=<SecurityLog {...{projectId}} role={settings.projects?.[projectId]?.role}/>;
    else if(section==='workflow-settings')page=<WorkflowSettings {...{projectId}}/>;
    else if(section==='ticket-settings')page=<TicketSettings {...{projectId}}/>;
    else if(section==='suspended')page=<SuspendedMail {...{projectId}} role={settings.projects?.[projectId]?.role}/>;
    else if(section==='roles')page=<RolesPage {...{projectId}} role={settings.projects?.[projectId]?.role}/>;
    else if(section==='widget-settings')page=<WidgetSettingsPage {...{projectId}}/>;
    else if(section==='local-agent')page=<ComputersPage {...{projectId}} projectName={settings.projects[projectId]?.name}/>;
    else if(section==='delegation'&&recordId==='authorize')page=<DelegationAuthorize projectId={settings.isGlobalInbox?undefined:settings.project?.id}/>;
    else if(section==='delegation')page=<DelegationSettings projectId={settings.isGlobalInbox?undefined:settings.project?.id} projects={settings.projects}/>;
    else if(section==='procedures')page=<ProcedureSettings {...{projectId}} role={settings.projects?.[projectId]?.role}/>;
    else if(section==='training-runs')page=<TrainingRuns {...{projectId}}/>;
    else if(foreignUser)page=<PageNotFound action={<Link className="btn btn-primary" to="/users/profile">Go to your profile</Link>}/>;
    else if(section==='users')page=<AccountPage {...{projectId,section}}/>;
    else if(section==='admin')page=settings.isPlatformAdmin?<AdminPage/>:<AdminRequired/>;
    else if(section==='insights')page=<InsightsPage {...{projectId}}/>;
    else page=<PageNotFound/>;
    let title=titles[section]||'HappyToHelp';
    if(section==='suspended')title='Suspended email';
    if(section==='projects')title=segments[1]==='create'?'Create Project':'Projects';
    if(section==='articles')title=recordId==='import'?'Import articles':recordId==='create'?'New article':recordId?'Edit article':'Knowledge';
    if(section==='macros'&&recordId==='create')title='Save a Reply';
    if(section==='agents'&&recordId==='create')title='Invite Agent';
    if(section==='activation')title=<SetupTitle projectId={projectId}/>;
    if(section==='delegation')title=recordId==='authorize'?'Connect to Slate':'Connected applications';
    if(section==='github-settings')title='Project';
    if(section==='admin')title=settings.isPlatformAdmin?adminTitles[segments[1]||'projects']||'Admin':'Administration';
    if(settings.projectUnavailable)title='Project not found';
    else if(foreignUser)title='Not found';
    const header=<h1 className="header-title">{title}</h1>;
    // A page the account cannot open is a centred notice under its drawing, titled there; it has no page header.
    if([ProjectUnavailable,PageNotFound,AdminRequired].includes(page.type))return <div className="main-content"><div className="workspace-notice-page" key={pathname}>{React.cloneElement(page,{header})}</div></div>;
    // On a Settings page the rail is the Settings menu; below 1200px a pill above the title opens it in the menu sheet.
    const settingsProject=settings.isGlobalInbox||settings.projectUnavailable?null:segments[0]==='projects'?projectId:settings.project?.id;
    const inSettings=Boolean(settingsProject)&&onSettingsDestination(pathname,`/projects/${settingsProject}`);
    return <div className="main-content"><div className="container-fluid workspace-page-container">
        <div className="header workspace-page-header"><div className="header-body">
            <div className="workspace-page-heading"><div className="workspace-page-titles">
                {inSettings&&<SettingsMenuButton title={typeof title==='string'?title:'Setup'}/>}
                {section==='users'&&!foreignUser&&<h6 className="header-pretitle">Overview</h6>}
                {header}
            </div><div className="workspace-page-actions" id="workspace-header-actions"/></div>
            <div id="workspace-header-tabs"/>
        </div></div>
        <div className="workspace-page-content" key={pathname}>{page}</div>
    </div></div>;
}
