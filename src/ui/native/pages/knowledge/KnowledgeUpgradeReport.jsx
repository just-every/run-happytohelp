import React, {useEffect, useState} from 'react';
import {Link} from '@tanstack/react-router';
import {nativeRequest} from '../../transport';

export default function KnowledgeUpgradeReport({projectId}) {
    const [report,setReport] = useState(null), [error,setError] = useState(''), [busy,setBusy] = useState(false);
    const path = `/api/knowledge/${encodeURIComponent(projectId)}/upgrade-report`;
    useEffect(() => {
        const controller = new AbortController();
        setReport(null);setError('');
        nativeRequest(path,{signal:controller.signal}).then(result => {
            if (!controller.signal.aborted) setReport(result);
        }).catch(failure => {
            if (!controller.signal.aborted && ![403,404].includes(failure.status)) setError(failure.message);
        });
        return () => controller.abort();
    },[path]);
    const loadMore = async () => {
        setBusy(true);setError('');
        try {
            const next = await nativeRequest(`${path}?${new URLSearchParams({after:report.nextCursor})}`);
            setReport(current => ({...next,unpublishedArticles:[...current.unpublishedArticles,...next.unpublishedArticles]}));
        } catch (failure) {setError(failure.message);} finally {setBusy(false);}
    };
    if (!report && !error) return null;
    return <section className="knowledge-upgrade-report" aria-label="Knowledge upgrade report">
        <h2>Knowledge upgrade</h2>
        {error && <p role="alert">{error}</p>}
        {report && <>
            <p role="status">{report.status === 'completed' ? 'Completed' : report.status === 'failed' ? 'Needs attention' : 'In progress'}{report.completedAt ? ` · ${new Date(report.completedAt).toLocaleString()}` : ''}</p>
            <dl><div><dt>Text rows checked</dt><dd>{report.canonicalisedRows}</dd></div><div><dt>Rows converted to references</dt><dd>{report.changedRows}</dd></div><div><dt>Articles withdrawn</dt><dd>{report.affectedArticleCount}</dd></div></dl>
            <p className="settings-note">Articles in unpublished collections were withdrawn during the upgrade. Review the affected articles and their collection publication settings.</p>
            {report.unpublishedArticles.length ? <ul>{report.unpublishedArticles.map(article => <li key={article.id}><Link to={article.editorPath}>{article.title}</Link></li>)}</ul> : report.affectedArticleCount === 0 && <p>No articles were withdrawn by the upgrade.</p>}
            {report.unavailableArticleCount > 0 && <p className="settings-note">{report.unavailableArticleCount} affected {report.unavailableArticleCount === 1 ? 'article is' : 'articles are'} no longer available in this workspace.</p>}
            {report.nextCursor && <button type="button" className="btn btn-white" disabled={busy} onClick={loadMore}>{busy ? 'Loading…' : 'Show more articles'}</button>}
        </>}
    </section>;
}
