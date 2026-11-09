import { EditorLauncher } from '../../editor/EditorLauncher';
import { Suspense, useEffect } from 'react';
import { busyWait, isBusy } from '../dashboard/utils/busy';
import DashboardClient, { DashboardContent as PageContent, type DashboardContentProps } from './DashboardClient';
import { withVisualEdits } from '../../editor/VisualEditBoundary';
import { Link, useMatches, useRouter } from '@tanstack/react-router';
import { BrandLockup } from '../homepage/BrandLockup';
import { DashboardSettingsContext, useDashboardSessionVersion, invalidateDashboardSession, useWorkspaceBusy } from './dashboard-state';
import '../homepage/outfit.css';
import '../homepage/brand-tokens.css';
import '../identity/identity.css';
import '../dashboard/styles/dashboard.scss';
import { PenLine, QuestionBubble } from './drawings';
import StepUpHost from './StepUpDialog';


const Content = withVisualEdits(PageContent);

// Before the workspace loads, and when it cannot: the identity pages' paper frame under the HappyToHelp lockup.
export function DashboardPending({ busy: waiting = false }: { busy?: boolean }) {
    const busy = useWorkspaceBusy() || waiting;
    return <main className="h2h-identity dashboard-state" aria-busy="true"><header className="id-header"><BrandLockup home="/" /></header>
        <div className="dashboard-state__body"><PenLine progress />{busy
            ? <p className="dashboard-state__message" role="status">The workspace is busy. Trying again in a few seconds…</p>
            : <p className="dashboard-state__message">Loading your workspace…</p>}</div>
    </main>;
}
export function DashboardError({ error }: { error: unknown }) {
    const router = useRouter();
    const busy = isBusy(error);
    useEffect(() => { delete (window as any).chatSettings; }, []);
    // A busy database or a dropped answer is a wait, not a failure: read the workspace again after its Retry-After.
    useEffect(() => {
        if (!busy) return;
        const timer = setTimeout(() => { void router.invalidate(); }, busyWait(error));
        return () => clearTimeout(timer);
    }, [busy, error, router]);
    if (busy) return <DashboardPending busy />;
    // Only an expired session offers sign-in; any other failure leaves a signed-in user a way to retry or leave.
    const expired = (error as { status?: number } | null)?.status === 401;
    return <main className="h2h-identity dashboard-state"><header className="id-header"><h1 className="dashboard-error-brand"><BrandLockup home="/" /></h1></header>
        <div className="dashboard-state__body"><QuestionBubble />
            <p className="dashboard-state__message" role="alert">{error instanceof Error ? error.message : 'The workspace could not be loaded.'}</p>
            {expired ? <div className="id-actions"><Link className="pill pill--ink" to="/login">Sign in</Link></div>
                : <div className="id-actions"><button type="button" className="pill pill--ink" onClick={() => { void router.invalidate(); }}>Try again</button><span className="id-links"><Link to="/">Back to the inbox</Link></span></div>}
        </div>
    </main>;
}
// Inside the shell, while a page's code loads: one quiet line where the page will be.
function ContentPending() {
    return <div className="dashboard-content-pending" aria-busy="true"><p>Loading your workspace…</p></div>;
}
export function DashboardContent(props: DashboardContentProps) {
    return <Suspense fallback={<ContentPending />}><Content {...props} /></Suspense>;
}
export default function Dashboard() {
    const match = useMatches({ select: matches => matches.at(-1) });
    const settings = match?.loaderData as any;
    const router = useRouter();
    useEffect(() => {
        const expired = () => {
            invalidateDashboardSession(router);
            void router.navigate({ to: '/login', search: { returnTo: router.state.location.href }, replace: true, ignoreBlocker: true });
        };
        window.addEventListener('h2h:session-expired', expired);
        return () => window.removeEventListener('h2h:session-expired', expired);
    }, [router]);
    const sessionVersion = useDashboardSessionVersion();
    const busy = useWorkspaceBusy();
    if (match?.status === 'error') return <DashboardError error={match.error} />;
    if (!settings || settings.sessionVersion !== sessionVersion) return <DashboardPending />;
    // Embedded widgets still consume this compatibility object. Routing uses loader context.
    (window as any).chatSettings = settings;
    return <DashboardSettingsContext.Provider value={settings}>
        <EditorLauncher authorized={!!settings.project && ['owner', 'admin'].includes(settings.project.role)} />
        <Suspense fallback={<DashboardPending />}><DashboardClient settings={settings} /></Suspense>
        {busy && <p className="dashboard-busy" role="status">The workspace is busy. Trying again in a few seconds…</p>}
        <StepUpHost />
    </DashboardSettingsContext.Provider>;
}
