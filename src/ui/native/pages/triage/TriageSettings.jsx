import React, { useEffect, useRef, useState } from 'react';
import { nativeRequest } from '../../transport';
import { Field, Feedback, Section } from '../forms';
import { json, ticketPath } from '../workflows/workflow-model';
import TriageAccuracy from './TriageAccuracy';
import TriageTaxonomy from './TriageTaxonomy';
import './triage-settings.css';

export default function TriageSettings({ projectId, changed, clean }) {
    const path = `${ticketPath(projectId)}/triage-settings`, currentPath = useRef(path);
    const [settings, setSettings] = useState(null), [draft, setDraft] = useState(null);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
    const [dirty, setDirty] = useState(false), [reviewed, setReviewed] = useState(false);
    const accept = data => { setSettings(data); setDraft(structuredClone(data)); setReviewed(false); setDirty(false); clean(); };
    useEffect(() => {
        let active = true;
        currentPath.current = path;
        setSettings(null); setDraft(null); setError(''); setSaved(false); setDirty(false); setReviewed(false);
        nativeRequest(path).then(result => { if (active) { setSettings(result.data); setDraft(structuredClone(result.data)); } }).catch(failure => { if (active) setError(failure.message); });
        return () => { active = false; currentPath.current = null; clean(); };
    }, [path]);
    const change = (key, value) => {
        changed(); setDirty(true); setSaved(false);
        if (key === 'taxonomy') setReviewed(false);
        setDraft(current => ({ ...current, [key]: value, ...(key === 'enabled' && !value ? { routing_enabled: false } : {}) }));
    };
    const save = async event => {
        event.preventDefault(); setError(''); setSaved(false);
        if (draft.routing_enabled && !settings.routing_enabled && !reviewed) { setError('Review accuracy by intent before enabling prediction routing.'); return; }
        setBusy(true);
        try {
            const { enabled, threshold, default_group_id, routing_enabled, taxonomy, version } = draft;
            const result = await nativeRequest(path, json('PUT', { enabled, threshold, default_group_id, routing_enabled, taxonomy, version, accuracy_reviewed: reviewed }));
            if (currentPath.current === path) { accept(result.data); setSaved(true); }
        } catch (failure) { if (currentPath.current === path) setError(failure.message); }
        finally { if (currentPath.current === path) setBusy(false); }
    };
    const reload = async () => {
        if (dirty && !window.confirm('Discard unsaved triage settings and reload?')) return;
        setBusy(true); setError(''); setSaved(false);
        try { const result = await nativeRequest(path); if (currentPath.current === path) accept(result.data); }
        catch (failure) { if (currentPath.current === path) setError(failure.message); }
        finally { if (currentPath.current === path) setBusy(false); }
    };
    const canEdit = settings?.permissions.settings === true;
    const hasLabels = settings?.accuracy.some(row => row.total > 0);
    return <div className="triage-settings">
        <Feedback error={error} saved={saved}/>
        {!settings && !error && <p role="status">Loading triage settings…</p>}
        {!settings && error && <button className="workflow-secondary" type="button" disabled={busy} onClick={reload}>Retry loading triage</button>}
        {draft && <form onSubmit={save}>
            {!canEdit && <p className="settings-note">Your role can read triage settings. Settings permission is required to make changes.</p>}
            <fieldset disabled={!canEdit || busy}>
                <Section card title="Intelligent triage" description="Classify incoming customer messages for intent, sentiment and language using the configured AI service. Each prediction keeps its confidence and quoted evidence.">
                    <Field name="triage-enabled" label="Enable triage" type="checkbox" value={draft.enabled} onChange={(_, value) => change('enabled', value)}/>
                    <div className="workflow-grid triage-controls">
                        <Field name="triage-threshold" label="Confidence threshold" hint="A value from 0 to 1. Predictions below this threshold go to the default queue." type="number" min={0} max={1} step="any" required value={draft.threshold} onChange={(_, value) => change('threshold', value)}/>
                        <Field name="triage-default-group" label="Default queue" hint="Used when a prediction has low confidence." value={draft.default_group_id || ''} options={[{ value: '', label: 'Workspace unassigned queue' }, ...settings.groups.map(group => ({ value: group.id, label: group.name }))]} onChange={(_, value) => change('default_group_id', value || null)}/>
                    </div>
                </Section>
                <Section card title="Intent taxonomy" description="Use intents that match the requests your team handles.">
                    <TriageTaxonomy rows={draft.taxonomy} onChange={value => change('taxonomy', value)}/>
                </Section>
                <Section card title="Accuracy and prediction routing" description="Review accuracy against operator corrections before allowing predictions to drive routing rules.">
                    <TriageAccuracy rows={settings.accuracy}/>
                    {!hasLabels && <p className="settings-note">Routing can be enabled after operators label predictions and accuracy is available.</p>}
                    {!settings.routing_enabled && <fieldset disabled={!hasLabels} className="triage-routing-review"><Field name="triage-accuracy-reviewed" label="I reviewed accuracy by intent" type="checkbox" value={reviewed} onChange={(_, value) => { setReviewed(value); setSaved(false); }}/></fieldset>}
                    <fieldset disabled={!draft.enabled || !settings.routing_enabled && (!hasLabels || !reviewed)} className="triage-routing-review"><Field name="triage-routing-enabled" label="Use predictions for routing" type="checkbox" value={draft.routing_enabled} onChange={(_, value) => change('routing_enabled', value)}/></fieldset>
                </Section>
                {canEdit && <button className="btn btn-primary" disabled={!dirty || busy || draft.routing_enabled && !settings.routing_enabled && !reviewed}>{busy ? 'Saving…' : 'Save triage settings'}</button>}
            </fieldset>
            <button type="button" className="btn btn-link" disabled={busy} onClick={reload}>Reload triage settings</button>
        </form>}
    </div>;
}
