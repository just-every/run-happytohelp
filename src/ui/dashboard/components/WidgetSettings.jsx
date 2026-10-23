import CampaignSettings from './widget-settings/CampaignSettings';
import {widgetAppearance} from '../../../modules/widget/appearance';
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Tab, Tabs } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { WidgetSettingsContext } from '../contexts/WidgetSettingsContext';
import WidgetAppearanceFields, { appearanceFieldNames } from './widget-settings/WidgetAppearanceFields';
import WidgetBehaviorFields, { behaviorFieldNames } from './widget-settings/WidgetBehaviorFields';
import WidgetTextFields, { textFieldNames } from './widget-settings/WidgetTextFields';
import { effectiveSettings, previewSettings, settingsToSave } from './widget-settings/settingsModel';
import WidgetInstallationCode from './widget-settings/WidgetInstallationCode';
import { nativeRequest } from '../../native/transport';
import WidgetPreview from './widget-settings/WidgetPreview';
import { useUnsavedChanges } from '../../native/NavigationGuard';

const fieldNames = [...appearanceFieldNames, ...behaviorFieldNames, ...textFieldNames];

export default function WidgetSettings({ projectId }) {
    const { markDirty, markSaved } = useUnsavedChanges();
    const { settings, csrfToken, previewAgent, previewBrand, mailMode, allowedOrigin } = useContext(WidgetSettingsContext);
    // The form shows the effective widget (saved overrides over the widget defaults). Only fields the
    // person edits are tracked, so saving without edits stores nothing new and one edit touches one value.
    const { register, getValues } = useForm({ defaultValues: useMemo(() => ({...effectiveSettings(settings, fieldNames, previewBrand), allowed_origin: allowedOrigin}), []) });
    const savedSettings = useRef(settings);
    const editedFields = useRef(new Set());
    const edits = () => Object.fromEntries([...editedFields.current].filter(name => name !== 'allowed_origin').map(name => [name, getValues(name)]));
    const [saveError, setSaveError] = useState('');
    const [saved, setSaved] = useState(false);
    const save = async event => {
        event.preventDefault(); setSaveError(''); setSaved(false);
        const body = settingsToSave(savedSettings.current, edits(), previewBrand);
        const payload = editedFields.current.has('allowed_origin') ? {...body, allowed_origin: getValues('allowed_origin')} : body;
        try {
            await nativeRequest(`/api/management/projects/${projectId}/widget-settings`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            savedSettings.current = body; editedFields.current.clear();
            markSaved(); setSaved(true);
        } catch(error) { setSaveError(error.message); }
    };
    const changed = event => {
        if (fieldNames.includes(event.target.name) || event.target.name === 'allowed_origin') editedFields.current.add(event.target.name);
        if (event.target.closest('.campaign-settings')) return;
        markDirty(); setSaved(false);
        window.h2h('settings', previewSettings(savedSettings.current, edits(), previewBrand));
    };
    // A link can open one tab by name, as Setup's Website link opens Settings: /widget-settings#settings.
    const [activeTab, setActiveTab] = useState(() => { const named = typeof window === 'undefined' ? '' : window.location.hash.slice(1); return ['code', 'theme', 'texts', 'settings', 'campaigns'].includes(named) ? named : 'code'; });
    const [previewOpen, setPreviewOpen] = useState(true);

    useEffect(() => {
        let preview;
        // Wait until React finishes committing before creating the separate widget root.
        const mount = setTimeout(() => {
            preview = window.h2h('preview', {
                ...widgetAppearance(previewBrand, settings),
                targetElementId: 'happytohelp',
                inline: true,
                inlineSettings: true,
                preview: {
                    enabled: true,
                    open: true,
                    onOpenChange: setPreviewOpen,
                    agent: previewAgent,
                    mailMode,
                    workspace_brand: previewBrand,
                },
            });
        }, 0);
        return () => {
            clearTimeout(mount);
            if (preview) setTimeout(() => preview.destroy(), 0);
        };
    }, []);

    const changePreviewState = open => {
        setPreviewOpen(open);
        window.h2h('settings', { preview: { open } });
    };

    return (
        <div className={`widget-settings-layout${['code','campaigns'].includes(activeTab) ? ' widget-settings-layout--code' : ''}`}>
            <form onChange={changed} onSubmit={save}>
                {saveError && <p role="alert">{saveError}</p>}{saved && <p role="status">Saved.</p>}
                <Tabs activeKey={activeTab} onSelect={setActiveTab} id="widget-settings-tabs" transition={false}>
                    <Tab eventKey="code" title="Code"><WidgetInstallationCode /></Tab>
                    <Tab eventKey="theme" title="Theme"><WidgetAppearanceFields register={register} /></Tab>
                    <Tab eventKey="settings" title="Settings"><section className="settings-section"><h2>Website origin</h2><label htmlFor="widget-website-origin" className="form-label">Widget website origin</label><input id="widget-website-origin" className="form-control" type="url" required {...register('allowed_origin')} aria-describedby="widget-origin-hint"/><p id="widget-origin-hint" className="form-text">The exact website allowed to use this widget, for example https://shop.example.com or http://127.0.0.1:8840. Use only the scheme, hostname and optional port. Saving replaces the previous origin without removing your conversations.</p></section><WidgetBehaviorFields register={register} projectId={projectId} /></Tab>
                    <Tab eventKey="campaigns" title="Campaigns"><CampaignSettings projectId={projectId}/></Tab>
                    <Tab eventKey="texts" title="Texts"><WidgetTextFields register={register} /></Tab>
                </Tabs>
                <div className="settings-actions" hidden={['code','campaigns'].includes(activeTab)}><button type="submit" className="btn btn-primary">Save</button></div>
            </form>
            <WidgetPreview open={previewOpen} onOpenChange={changePreviewState} hidden={['code','campaigns'].includes(activeTab)} />
        </div>
    );
}
