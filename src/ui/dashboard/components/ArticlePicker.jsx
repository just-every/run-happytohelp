import React, {useEffect, useState} from 'react';
import {nativeRequest} from '../../native/transport';
import './ArticlePicker.css';

/** The server selects articles for this conversation's customer on every read and insertion. */
export default function ArticlePicker({projectId, conversationId, onPicked, cc = [], bcc = []}) {
    const [query, setQuery] = useState(''), [articles, setArticles] = useState(null);
    const [showInternal, setShowInternal] = useState(false);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const endpoint = `/api/knowledge/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/articles`;
    const audience = JSON.stringify({cc,bcc});
    useEffect(() => {
        const controller = new AbortController();
        setArticles(null); setError('');
        const timer = setTimeout(() => nativeRequest(`${endpoint}?${new URLSearchParams({q:query,cc:JSON.stringify(cc),bcc:JSON.stringify(bcc)})}`, {signal:controller.signal})
            .then(result => { if (!controller.signal.aborted) setArticles(result.articles || result); })
            .catch(failure => { if (!controller.signal.aborted) setError(failure.message); }), query ? 180 : 0);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [endpoint, query, audience]);
    const insert = async (article, mode) => {
        setBusy(true); setError('');
        try {
            const result = await nativeRequest(`${endpoint}/${encodeURIComponent(article.id)}/insert`, {
                method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mode,cc,bcc}),
            });
            onPicked(result.token, {references:result.references});
        } catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    };
    return <section className="article-picker" aria-label="Insert a help article">
        <h2>Help articles</h2>
        <p>Insert articles visible to every current recipient. Access is checked again when you send.</p>
        <input type="search" className="form-control" aria-label="Search help articles" placeholder="Search help articles" value={query} onChange={event => setQuery(event.target.value)}/>
        {error && <p role="alert">{error}</p>}
        {!articles && !error && <p role="status">Loading articles…</p>}
        {articles?.length === 0 && <p role="status">No matching articles for this customer.</p>}
        <label className="article-picker__internal"><input type="checkbox" checked={showInternal} onChange={event => setShowInternal(event.target.checked)}/> Show internal articles</label>
        <ul>{articles?.filter(article => article.insertable || showInternal).map(article => <li key={article.id} className={article.insertable ? undefined : 'article-picker__blocked'}>
            <span><strong>{article.title}</strong>{article.summary && <small>{article.summary}</small>}{article.preview && <details><summary>Preview article</summary><pre>{typeof article.preview === 'string' ? article.preview : article.preview.content}</pre></details>}{!article.insertable && <ul className="article-picker__reasons">{article.blockedRecipients?.map((recipient,index) => <li key={index}>Unavailable for {recipient.label}: {recipient.reason}</li>)}</ul>}</span>
            <div><button type="button" className="btn btn-sm btn-white" disabled={busy || !article.insertable} onClick={() => insert(article, 'link')}>Insert link</button><button type="button" className="btn btn-sm btn-white" disabled={busy || !article.insertable} onClick={() => insert(article, 'text')}>Insert text</button></div>
        </li>)}</ul>
    </section>;
}
