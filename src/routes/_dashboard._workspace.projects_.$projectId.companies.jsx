import { createFileRoute } from '@tanstack/react-router';
import { DashboardContent } from '../ui/native/Dashboard';
import { dashboardLoaderOptions } from '../ui/native/dashboard-state';
import WorkspacePages from '../ui/native/WorkspacePages';
import Companies from '../ui/native/pages/Companies';

export const Route = createFileRoute('/_dashboard/_workspace/projects_/$projectId/companies')({ ...dashboardLoaderOptions, component: CompaniesRoute });

function Workspace({ settings }) {
    return <WorkspacePages settings={settings} pages={{ Companies }}/>;
}

function CompaniesRoute() {
    return <DashboardContent Workspace={Workspace}/>;
}
