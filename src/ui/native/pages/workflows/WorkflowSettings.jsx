import React, { useEffect, useState } from 'react';
import { nativeRequest } from '../../transport';
import { useDashboardSettings } from '../../dashboard-state';
import { useUnsavedChanges } from '../../NavigationGuard';
import { SettingsTabs } from '../ProjectControls';
import { Feedback } from '../forms';
import CalendarSettings from './CalendarSettings';
import PolicySettings from './PolicySettings';
import RuleSettings from './RuleSettings';
import RoutingSettings from './RoutingSettings';
import TriageSettings from '../triage/TriageSettings';
import { ticketPath } from './workflow-model';
import './workflows.css';
export default function WorkflowSettings({ projectId }) {
    const workspace = useDashboardSettings(), { markDirty, markSaved } = useUnsavedChanges();
    const [tab, setTab] = useState('calendars'), [settings, setSettings] = useState(null), [error, setError] = useState(''), [dirty, setDirty] = useState(false);
    useEffect(() => { let active = true; setSettings(null); Promise.all([nativeRequest(`${ticketPath(projectId)}/ticket-settings`), nativeRequest(`${ticketPath(projectId)}/tags`)]).then(([result, tags]) => { if (active) setSettings({...result.data, tags:tags.data}); }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, [projectId]);
    const changed = () => { setDirty(true); markDirty(); };
    const clean = () => { setDirty(false); markSaved(); };
    const switchTab = value => { if (value === tab || dirty && !window.confirm('Discard unsaved workflow changes?')) return; clean(); setTab(value); };
    const props = { projectId, settings, canEdit: settings?.permissions.settings === true, changed, clean, agents: workspace.projects?.[projectId]?.agents || [] };
    return <div className="workspace-settings workflow-settings">
        <SettingsTabs tab={tab} onChange={switchTab} tabs={[["calendars", "Business hours"], ["sla", "SLA policies"], ["rules", "Rules"], ["routing", "Routing"], ["triage", "Triage"]]}/>
        {tab === 'triage' ? <TriageSettings key={projectId} projectId={projectId} changed={changed} clean={clean}/> : <>
            <Feedback error={error}/>
            {!settings && !error && <p role="status">Loading workflow settings…</p>}
            {settings && <>
                {!props.canEdit && <p className="settings-note">Your role can read workflows. Owners and admins with settings permission can make changes.</p>}
                {tab === 'calendars' ? <CalendarSettings {...props}/> : tab === 'sla' ? <PolicySettings {...props}/> : tab === 'rules' ? <RuleSettings {...props}/> : <RoutingSettings {...props}/>}
            </>}
        </>}
    </div>;
}
