import { useUnsavedChanges } from '../NavigationGuard';
import { useNavigate } from '@tanstack/react-router';
import React, { useEffect, useState } from 'react';
import { nativeRequest } from '../transport';
import { Feedback } from './forms';
import { useConfirmation } from './ConfirmDialog';
import { deleteCopy } from './delete-copy';
import { validateDataset } from './knowledge/dataset-validation';
import ArticleEditorActions from './knowledge/ArticleEditorActions';
import KnowledgeLists from './knowledge/KnowledgeLists';
import KnowledgeWorkspace from './knowledge/KnowledgeWorkspace';
import ArticleGovernance from './knowledge/ArticleGovernance';
import { KnowledgeFields } from './knowledge/KnowledgeForms';
import KnowledgeTabs from './knowledge/KnowledgeTabs';
import DatasetProgress, { datasetIsActive } from './knowledge/DatasetProgress';
import { SourceOrigin, canCrawl } from './knowledge/source-origin';
import WebsiteReader, { WebsiteReadFailure, useWebsiteReader } from './knowledge/WebsiteReader';
import './knowledge/knowledge.css';
import './stack-table.css';

const normalize = row => ({
    ...row,
    is_published: Boolean(row.is_published),
    refreshMode: row.refresh_mode || 'adaptive',
    excluded_urls: Array.isArray(row.excluded_urls) ? row.excluded_urls.join('\n') : parseExclusions(row.excluded_urls),
    categories: Array.isArray(row.categories) ? row.categories : [],
    audience: row.audience || 'public',
    allowedDomains: Array.isArray(row.allowedDomains) ? row.allowedDomains : parseExclusions(row.allowed_domains || '[]'),
});

function parseExclusions(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed.join('\n') : String(parsed);
    } catch {
        return value || '';
    }
}

export default function KnowledgePage({ projectId, section, recordId, project }) {
    const { markDirty, markSaved } = useUnsavedChanges();
    const navigate = useNavigate();
    const { ask, dialog } = useConfirmation();
    const path = '/api/knowledge/' + projectId + '/' + section;
    const [categories, setCategories] = useState([]);
    const [pages, setPages] = useState([]);
    const [items, setItems] = useState(null);
    const [draft, setDraft] = useState(null);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [savedStatus, setSavedStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const [tab, setTab] = useState('overview');
    const [fieldErrors, setFieldErrors] = useState({});
    const reader = useWebsiteReader(projectId, section === 'datasets');
    const datasetActive = section === 'datasets' && Boolean(items?.some(datasetIsActive));
    const articleReady = Boolean(draft && (recordId === 'create' ? !draft.id : draft.id === recordId));

    const load = async () => {
        const response = await nativeRequest(path);
        const rows = response.data || response;
        setItems(rows);
        if (recordId && recordId !== 'create') {
            const row = rows.find(item => item.id === recordId);
            if (!row) throw new Error('This record was not found.');
            setDraft(normalize(row));
        }
    };

    useEffect(() => {
        setDraft(null);
        setItems(null);
        setPages([]);
        setError('');
        setSaved(false);
        setSavedStatus('');
        setFieldErrors({});
        load().catch(loadError => setError(loadError.message));
        if (recordId === 'create') {
            setDraft({
                status: 'draft',
                is_published: false,
                refreshMode: 'adaptive',
                url: project?.website || '',
                max_crawl_depth: 3,
                max_crawl_pages: 40,
                categories: [],
            });
        }
    }, [path, recordId]);

    useEffect(() => {
        if (section !== 'datasets') {
            nativeRequest('/api/knowledge/' + projectId + '/categories')
                .then(setCategories)
                .catch(loadError => setError(loadError.message));
        }
        if (section === 'datasets' && recordId && recordId !== 'create') {
            nativeRequest(path + '/' + recordId + '/pages')
                .then(response => setPages(response.data || response.pages || response))
                .catch(loadError => setError(loadError.message));
        }
    }, [path, recordId, draft?.published_version]);

    useEffect(() => {
        if (!datasetActive) return;
        let cancelled = false;
        let timer;
        const poll = async () => {
            try {
                const response = await nativeRequest(path);
                const rows = response.data || response;
                if (cancelled) return;
                setItems(rows);
                const row = rows.find(item => item.id === recordId);
                if (row) {
                    // Poll only server-owned progress; preserve any settings being edited.
                    setDraft(current => current?.id === row.id ? {
                        ...current,
                        status: row.status,
                        claim_token: row.claim_token,
                        ingest_cursor: row.ingest_cursor,
                        error: row.error,
                        published_version: row.published_version,
                        last_refreshed_at: row.last_refreshed_at,
                        page_count: row.page_count,
                    } : current);
                }
            } catch (pollError) {
                if (!cancelled) setError(pollError.message);
            }
            if (!cancelled) timer = setTimeout(poll, 2000);
        };
        timer = setTimeout(poll, 2000);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [path, recordId, datasetActive]);

    const change = (key, value) => {
        markDirty();
        setSaved(false);
        setSavedStatus('');
        setDraft(current => ({ ...current, [key]: value }));
        setFieldErrors(current => {
            const { [key]: removed, ...remaining } = current;
            return remaining;
        });
    };

    const save = async (event, publication = null) => {
        event?.preventDefault();
        // The persistent article actions are visible before its record arrives.
        // Never submit an empty or stale record, including a programmatic submit.
        if (!draft || busy || (section === 'articles' && !articleReady)) return;
        setError('');
        setSaved(false);
        setSavedStatus('');
        if (section === 'datasets') {
            const problems = validateDataset(draft);
            if (problems) {
                setFieldErrors(problems);
                return;
            }
        }

        setBusy(true);
        try {
            const isPublished = section === 'articles'
                ? publication ?? Boolean(draft.is_published)
                : Boolean(draft.is_published);
            const body = { ...draft, is_published: isPublished, status: isPublished ? 'published' : 'draft' };
            delete body.categoryIds;
            delete body.categoryId;
            delete body.parentId;
            if (section === 'datasets') {
                body.name = draft.name || draft.url;
                body.excluded_urls = (draft.excluded_urls || '').split('\n').map(value => value.trim()).filter(Boolean);
                delete body.refresh_mode;
            }
            if (section === 'categories') {
                body.parent_id = draft.parent_id || null;
                body.allowedDomains = Array.isArray(draft.allowedDomains) ? draft.allowedDomains : (draft.allowedDomains || '').split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
            }

            const result = await nativeRequest(path + (draft.id && section !== 'articles' ? '/' + draft.id : ''), {
                method: draft.id && section !== 'articles' ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if(section === 'categories' && draft.entitlementContactIds !== undefined) {
                await nativeRequest(`/api/knowledge/${projectId}/categories/${draft.id || result.id}/entitlements`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({required:!!draft.requires_entitlement,contactIds:draft.requires_entitlement?draft.entitlementContactIds:[]})});
            }
            markSaved();
            if (!draft.id) {
                await navigate({ to: '/projects/' + projectId + '/' + section + '/' + result.id, replace: true });
                return;
            }

            setSaved(true);
            setSavedStatus(section === 'articles' ? (isPublished ? 'Published' : 'Saved as draft') : '');
            await load();
        } catch (saveError) {
            setError(saveError.message);
        } finally {
            setBusy(false);
        }
    };

    const remove = item => {
        const copy = deleteCopy[section];
        ask({
            title: copy.title(item),
            body: <p>{copy.effect}</p>,
            run: async () => {
                await nativeRequest(path + '/' + item.id, { method: 'DELETE' });
                markSaved();
                if (recordId) await navigate({ to: '/projects/' + projectId + '/' + section });
                else await load();
            },
        });
    };

    const refresh = async () => {
        setError('');
        setBusy(true);
        try {
            await nativeRequest(path + '/' + draft.id + '/crawl', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            await load();
        } catch (refreshError) {
            setError(refreshError.message);
        } finally {
            setBusy(false);
        }
    };

    const existingDataset = section === 'datasets' && draft?.id;
    const isArticle = section === 'articles';

    return <div className="knowledge-page">
        <KnowledgeTabs projectId={projectId} activeSection={section}/>
        <Feedback error={error} saved={saved && !isArticle}/>
        {!items && !error && <p role="status">Loading…</p>}
        {!recordId && items && (isArticle ? <KnowledgeWorkspace {...{ section, items, projectId, categories, remove, project }}/> : <KnowledgeLists {...{ section, items, projectId, categories, remove }}/>)}
        {(draft || (isArticle && recordId)) && <>
            {existingDataset && <>
                <h2 className="knowledge-website-title">{draft.url || draft.name}</h2>
                <ul className="nav nav-tabs mb-4">
                    {['overview', 'pages', 'settings'].map(value => <li className="nav-item" key={value}>
                        <button className={'nav-link' + (tab === value ? ' active' : '')} onClick={() => setTab(value)}>
                            {value === 'pages' ? 'Indexed pages' : value[0].toUpperCase() + value.slice(1)}
                        </button>
                    </li>)}
                </ul>
            </>}
            {existingDataset && tab === 'overview' ? <div className="knowledge-form">
                <dl>
                    <dt>Status</dt><dd><DatasetProgress source={draft}/></dd>
                    <dt>Last refreshed</dt><dd>{draft.last_refreshed_at ? new Date(draft.last_refreshed_at).toLocaleString() : 'Not recorded'}</dd>
                    <dt>Indexed pages</dt><dd>{draft.page_count ?? pages.length}</dd>
                </dl>
                <WebsiteReadFailure error={draft.status === 'failed' ? draft.error : ''}/>
                {canCrawl(draft) ? <><button className="btn btn-primary" disabled={busy || datasetIsActive(draft)} onClick={refresh}>Refresh now</button><WebsiteReader reader={reader}/></> : <SourceOrigin source={draft}/>}
            </div> : existingDataset && tab === 'pages' ? <div className="table-responsive">
                <table className="table knowledge-table stack-table">
                    <thead><tr><th>Page</th><th>Content</th></tr></thead>
                    <tbody>{pages.map(page => <tr key={page.id || page.url}>
                        <td data-label="Page"><a href={page.url}>{page.title || page.url}</a></td>
                        <td data-label="Content">{page.content?.length ?? 0} characters</td>
                    </tr>)}</tbody>
                </table>
                {!pages.length && <p>No indexed pages yet.</p>}
            </div> : existingDataset && tab === 'settings' && !canCrawl(draft) ? <div className="knowledge-form">
                <SourceOrigin source={draft}/>
                <div className="knowledge-form-actions">
                    <button type="button" className="btn btn-link text-danger" disabled={busy} onClick={() => remove(draft)}>Delete</button>
                </div>
            </div> : <form
                className={'knowledge-form' + (isArticle ? ' knowledge-form-wide' : '')}
                onSubmit={event => save(event)}
                noValidate={section === 'datasets'}
            >
                {isArticle && <ArticleEditorActions
                    isPublished={articleReady && Boolean(draft.is_published)}
                    savedStatus={!articleReady ? (error ? 'Unavailable' : 'Loading…') : savedStatus}
                    busy={busy}
                    unavailable={!articleReady}
                    onPublish={event => save(event, true)}
                    onUnpublish={event => save(event, false)}
                    onDelete={articleReady && draft.id ? () => remove(draft) : undefined}
                />}
                {section === 'datasets' && <WebsiteReader reader={reader}/>}
                {isArticle && articleReady && draft.is_published && draft.slug && <p className="settings-note knowledge-public-address">Published on your Help Center: <a href={`/help/${projectId}/${draft.slug}`} target="_blank" rel="noreferrer">{`${window.location.origin}/help/${projectId}/${draft.slug}`}</a></p>}
                {draft && (!isArticle || articleReady) && <KnowledgeFields {...{ projectId, section, draft, change, categories, fieldErrors }}/>}
                {!isArticle && <div className="knowledge-form-actions">
                    <button className="btn btn-primary" disabled={busy}>
                        {busy ? 'Saving…' : draft.id ? 'Save' : section === 'datasets' ? 'Add URL' : 'Create'}
                    </button>
                    {draft.id && <button type="button" className="btn btn-link text-danger" disabled={busy} onClick={() => remove(draft)}>Delete</button>}
                </div>}
            </form>}
            {isArticle && articleReady && draft.id && <ArticleGovernance key={draft.id} projectId={projectId} article={draft} onRollback={async () => { markSaved(); await load(); setSavedStatus('Restored version'); }}/>}
        </>}
        {dialog}
    </div>;
}
