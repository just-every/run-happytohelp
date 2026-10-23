import React, { useEffect, useState } from 'react';
import { useDashboardSettings, useDashboardLocation } from '../../dashboard-state';
import { nativeRequest } from '../../transport';
import { useUnsavedChanges } from '../../NavigationGuard';
import { Feedback, Section } from '../forms';
import { SettingsTabs } from '../ProjectControls';
import { useConfirmation } from '../ConfirmDialog';
import TicketSettingsForm from './TicketSettingsForm';
import '../stack-table.css';
import { json, label, ticketPath } from '../../../dashboard/components/tickets/ticket-model';
import '../../../dashboard/components/tickets/tickets.css';

const blanks = { statuses: { name: '', category: 'open' }, fields: { name: '', type: 'text', required: false, options: [], validation: {}, read_roles: ['owner', 'admin', 'operator', 'collaborator', 'api'], write_roles: ['owner', 'admin', 'operator', 'api'] }, groups: { name: '', members: [] } };
const singular = { statuses: 'status', fields: 'field', groups: 'group' };
export default function TicketSettings({ projectId }) {
    const location = useDashboardLocation(), requestedTab = new URLSearchParams(location.searchStr).get('tab');
    const workspace = useDashboardSettings(), { markDirty, markSaved } = useUnsavedChanges();
    const { ask, dialog } = useConfirmation();
    const [data, setData] = useState(null), [kind, setKind] = useState(['statuses','fields','groups'].includes(requestedTab) ? requestedTab : 'statuses'), [draft, setDraft] = useState(null);
    const [error, setError] = useState(''), [saved, setSaved] = useState(false), [busy, setBusy] = useState(false);
    const base = ticketPath(projectId), resource = `${base}/ticket-${kind}`;
    const load = async () => setData((await nativeRequest(`${base}/ticket-settings`)).data);
    useEffect(() => { let active = true; setData(null); nativeRequest(`${base}/ticket-settings`).then(result => { if (active) setData(result.data); }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, [base]);
    const edit = item => { setDraft(item ? structuredClone(item) : structuredClone(blanks[kind])); setSaved(false); setError(''); };
    const setChangedDraft = update => { markDirty(); setSaved(false); setDraft(update); };
    const save = async event => {
        event.preventDefault(); setBusy(true); setError('');
        const body = Object.fromEntries(Object.keys(blanks[kind]).map(key => [key, draft[key]]));
        if (kind === 'fields') body.options = body.options.map(value => value.trim()).filter(Boolean);
        try { await nativeRequest(draft.id ? `${resource}/${encodeURIComponent(draft.id)}` : resource, json(draft.id ? 'PATCH' : 'POST', body)); setDraft(null); markSaved(); setSaved(true); await load(); }
        catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const remove = item => ask({ title: `Delete ${item.name}?`, body: <p>{kind === 'statuses' ? 'This status will be disabled for future changes. Existing tickets and history keep their status.' : kind === 'fields' ? 'This removes the field and its stored ticket values.' : 'Move tickets out of this group before deleting it.'}</p>, confirmLabel: kind === 'statuses' ? 'Disable status' : 'Delete', run: async () => { await nativeRequest(`${resource}/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); setSaved(true); await load(); } });
    const agents = workspace.projects?.[projectId]?.agents || [];
    const roles = (data?.roles || []).map(role => ({value: role.id, label: role.name}));
    if (!data) return <><Feedback error={error}/>{!error && <p role="status">Loading ticket settings…</p>}</>;
    return <div className="workspace-settings" aria-busy={busy}>
        <SettingsTabs tab={kind} onChange={value => { setKind(value); setDraft(null); markSaved(); setSaved(false); setError(''); }} tabs={[["statuses", "Statuses"], ["fields", "Fields"], ["groups", "Groups"]]}/>
        <Feedback error={error} saved={saved}/>
        <Section card title={`Ticket ${kind}`} description={kind === 'statuses' ? 'Custom statuses map to a lifecycle category. Pending waits on the customer; On-hold waits on your team or a third party. Internal labels stay private.' : kind === 'fields' ? 'Typed ticket fields are validated on the server. Read and edit permissions apply to every ticket and view.' : 'Organize the teammates who handle a queue.'}>
            <div className="ticket-settings-list">{data[kind].map(item => <article key={item.id} className="ticket-settings-item"><h3>{item.name}</h3>
                {kind === 'statuses' && <p className="settings-note">{label(item.category)}{item.is_default ? ' · Built-in status' : ''}{!item.active ? ' · Inactive' : ''}</p>}
                {kind === 'fields' && <><p className="settings-note">{label(item.type)}{item.required ? ' · Required' : ''}</p><p className="settings-note">Read: {item.read_roles.join(', ') || 'Every role'}<br/>Edit: {item.write_roles.join(', ') || 'Every role'}</p></>}
                {kind === 'groups' && <p className="settings-note">{item.members.length} {item.members.length === 1 ? 'member' : 'members'}</p>}
                {data.permissions.settings && !item.is_default && <div className="row-actions-inline"><button type="button" onClick={() => edit(item)}>Edit</button>{!item.is_default && (kind !== 'statuses' || item.active) && <button type="button" onClick={() => remove(item)}>{kind === 'statuses' ? 'Disable' : 'Delete'}</button>}</div>}
            </article>)}</div>
            {!data[kind].length && <p className="settings-note">No custom {kind} yet.</p>}
            {data.permissions.settings ? draft ? <TicketSettingsForm {...{kind, draft, busy, roles, agents}} setDraft={setChangedDraft} onSubmit={save} onCancel={() => { setDraft(null); markSaved(); }}/> : <button className="btn btn-primary mt-3" type="button" onClick={() => edit(null)}>New {singular[kind]}</button> : <p className="settings-note">Only workspace owners and admins can manage ticket settings.</p>}
        </Section>{dialog}
    </div>;
}
