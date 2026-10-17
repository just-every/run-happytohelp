import React, { useEffect, useRef, useState } from 'react';
import { nativeRequest } from '../../transport';
import { useNavigationGuard, useUnsavedChanges } from '../../NavigationGuard';
import { Feedback, Section } from '../forms';
import { useConfirmation } from '../ConfirmDialog';
import RequestFormEditor from './RequestFormEditor';
import { blankForm, formPath, jsonRequest } from './form-model';
import './request-forms.css';

export default function RequestFormsSettings({ projectId, role }) {
    const path = formPath(projectId), { markDirty, markSaved } = useUnsavedChanges(), { confirmNavigation } = useNavigationGuard();
    const [data, setData] = useState(null), [draft, setDraft] = useState(null), [error, setError] = useState(''), [saved, setSaved] = useState(false), [busy, setBusy] = useState(false);
    const { ask, dialog } = useConfirmation(), editorHeading = useRef(null);
    const canManage = ['owner', 'admin'].includes(role);
    useEffect(() => {
        const controller = new AbortController();
        setData(null); setDraft(null); setError(''); setSaved(false); markSaved();
        nativeRequest(path, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
        return () => controller.abort();
    }, [path, markSaved]);
    const edit = item => { setDraft(item ? structuredClone(item) : blankForm()); setSaved(false); setError(''); requestAnimationFrame(() => editorHeading.current?.focus()); };
    const change = value => { markDirty(); setSaved(false); setDraft(value); };
    const cancel = () => { if (confirmNavigation()) { setDraft(null); markSaved(); setError(''); } };
    const save = async event => {
        event.preventDefault(); setError(''); setSaved(false);
        try { if (!draft.locale || draft.locale.length > 35) throw new Error(); Intl.getCanonicalLocales(draft.locale); }
        catch { setError('Enter a valid default language code, such as en or en-US.'); return; }
        setBusy(true);
        try {
            const { data: form } = await nativeRequest(draft.id ? `${path}/${encodeURIComponent(draft.id)}` : path, jsonRequest(draft.id ? 'PATCH' : 'POST', draft));
            setData(current => ({ ...current, data: draft.id ? current.data.map(item => item.id === form.id ? form : item) : [...current.data, form] }));
            setDraft(null); markSaved(); setSaved(true);
        } catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    };
    const remove = form => ask({ title: `Delete ${form.title}?`, body: <p>Customers will no longer be able to open this form. Requests already submitted remain in your inbox.</p>, confirmLabel: 'Delete form', run: async () => { await nativeRequest(`${path}/${encodeURIComponent(form.id)}`, { method: 'DELETE' }); setData(current => ({ ...current, data: current.data.filter(item => item.id !== form.id) })); setSaved(false); } });
    return <div className="request-forms-settings" aria-busy={busy}>
        <Feedback error={error} saved={saved}/>
        {!data ? !error && <p role="status">Loading request forms…</p> : draft ? <><h2 ref={editorHeading} tabIndex={-1} className="request-forms-editor-heading">{draft.id ? draft.title : 'Create a request form'}</h2><RequestFormEditor draft={draft} definitions={data.fields} busy={busy} onChange={change} onSubmit={save} onCancel={cancel}/></> : <Section card title="Request forms" description="Give customers a focused way to ask for help, with the ticket fields and language each request needs.">
            {canManage && <button type="button" className="btn btn-primary" onClick={() => edit(null)}>New request form</button>}
            <div className="request-forms-list">{data.data.map(form => <article className="request-forms-list__item" key={form.id}><div><h3>{form.title}</h3><p className="settings-note">{form.enabled ? 'Published' : 'Draft'} · {form.fields.length} custom {form.fields.length === 1 ? 'field' : 'fields'} · {form.locale}</p>{form.description && <p>{form.description}</p>}</div>{canManage && <div className="request-forms-list__actions"><button type="button" className="btn btn-outline-secondary" onClick={() => edit(form)} aria-label={`Edit ${form.title}`}>Edit</button><button type="button" className="btn btn-link" onClick={() => remove(form)} aria-label={`Delete ${form.title}`}>Delete</button></div>}</article>)}</div>
            {!data.data.length && <p className="settings-note request-forms-empty">No request forms yet. Create one for a refund, order problem, or another common request.</p>}
            {!canManage && <p className="settings-note">Only workspace owners and admins can manage request forms.</p>}
        </Section>}{dialog}
    </div>;
}
