import React, { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { nativeRequest } from '../../transport';
import { useUnsavedChanges } from '../../NavigationGuard';
import { Field, Feedback } from '../forms';

const templateTypes = [['home', 'Home'], ['category', 'Category'], ['section', 'Section'], ['article', 'Article'], ['search', 'Search'], ['request', 'Request form']];

export default function KnowledgeExperience({ projectId, project, articles }) {
    const [draft, setDraft] = useState(null);
    const [localeText, setLocaleText] = useState('');
    const [type, setType] = useState('home');
    const [previewId, setPreviewId] = useState('');
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [busy, setBusy] = useState(false);
    const { markDirty, markSaved } = useUnsavedChanges();
    const path = `/api/knowledge/${projectId}/experience`;
    useEffect(() => {
        let active = true;
        nativeRequest(path).then(result => { if (active) { setDraft(result); setLocaleText(result.locales.join('\n')); } }).catch(e => { if (active) setError(e.message); });
        return () => { active = false; };
    }, [path]);
    const change = (name, value) => { markDirty(); setSaved(false); setDraft(current => ({...current, [name]: value})); };
    const locales = [...new Set(localeText.split(/[\s,]+/).map(value => value.trim()).filter(Boolean))];
    const submit = async event => {
        event.preventDefault(); setError(''); setSaved(false);
        if (!locales.length || !locales.includes(draft.defaultLocale)) { setError('Include the default locale in your available locales.'); return; }
        setBusy(true);
        try {
            await nativeRequest(path, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...draft, locales})});
            const result = await nativeRequest(path);
            setDraft(result); setLocaleText(result.locales.join('\n')); markSaved(); setSaved(true);
        } catch (e) { setError(e.message); } finally { setBusy(false); }
    };
    const article = articles.find(value => value.id === previewId);
    const context = article || {title: project?.brand_name || project?.name || '', summary: '', content: project?.welcome_message || ''};
    const template = draft?.templates[type] || '';
    const preview = template.replace(/\{\{(title|content|summary)\}\}/g, (_, key) => context[key] || '');
    return <section className="knowledge-form knowledge-experience">
        <h2>Help Center settings</h2>
        <Feedback error={error} saved={saved}/>
        {!draft && !error && <p role="status">Loading Help Center settings…</p>}
        {draft && <form onSubmit={submit}>
            <fieldset className="knowledge-governance-group"><legend>Published address</legend>
                <Field name="knowledge-published-host" label="Help Center address" value={draft.publishedHost??'deployment-default'} onChange={(_, value) => change('publishedHost', value==='deployment-default'?null:value)} options={[{value:'deployment-default',label:'Keep the deployment’s current addresses'},{value:'',label:'Use built-in Help Center paths'},...(draft.approvedHosts||[]).map(host=>({value:host,label:`https://${host}`}))]} hint="Your hosting administrator configures DNS, TLS and the workspace’s allowed hosts first. Saving publishes this Help Center at the selected approved address."/>
                {draft.publishedHost&&<p><a href={`https://${draft.publishedHost}`} target="_blank" rel="noreferrer">Open published Help Center</a></p>}
            </fieldset>
            <fieldset className="knowledge-governance-group"><legend>Languages</legend>
                <Field name="knowledge-locales" label="Available locales" type="textarea" rows={3} value={localeText} onChange={(_, value) => { markDirty(); setSaved(false); setLocaleText(value); }} required hint="One language tag per line, for example en, fr or pt-BR. Add a locale before writing its translations."/>
                <Field name="knowledge-default-locale" label="Default locale" value={draft.defaultLocale} onChange={(_, value) => change('defaultLocale', value)} options={[...new Set([draft.defaultLocale, ...locales])].map(value => ({value, label: value}))}/>
                <p className="settings-note">When a reviewed translation is unavailable, readers see the default language with a fallback notice.</p>
            </fieldset>
            <fieldset className="knowledge-governance-group"><legend>Page templates</legend>
                <Field name="knowledge-link-color" label="Article link color" value={draft.linkColor||''} onChange={(_, value) => change('linkColor',value)} placeholder="#204b3a" hint="Optional six-digit hex color. Publication requires at least 4.5:1 contrast on white; leave empty to use the workspace’s readable accent."/>
                <p className="settings-note">Use plain text with <code>{'{{title}}'}</code>, <code>{'{{summary}}'}</code> and <code>{'{{content}}'}</code>. Templates add text around the page content. Leave a template empty to use the standard page.</p>
                <Field name="knowledge-template-type" label="Page to customize" value={type} onChange={(_, value) => setType(value)} options={templateTypes.map(([value, label]) => ({value, label}))}/>
                <Field name="knowledge-template" label={`${templateTypes.find(([value]) => value === type)[1]} template`} value={template} type="textarea" rows={7} onChange={(_, value) => change('templates', {...draft.templates, [type]: value})}/>
                <div className="knowledge-template-preview">
                    <h3>Template preview</h3>
                    <Field name="knowledge-preview-source" label="Preview content" value={previewId} onChange={(_, value) => setPreviewId(value)} options={[{value: '', label: 'Help Center name and welcome message'}, ...articles.map(value => ({value: value.id, label: value.title}))]}/>
                    {template ? <pre aria-live="polite">{preview}</pre> : <p>The standard page will be used.</p>}
                    <p className="settings-note">Preview uses your current workspace or article content. Saving applies the Help Center templates. The request form template appears around your published request forms.</p>
                </div>
            </fieldset>
            <p><Link to={`/projects/${projectId}/settings`}>Workspace branding and Help Center domain</Link></p>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save Help Center settings'}</button>
        </form>}
    </section>;
}
