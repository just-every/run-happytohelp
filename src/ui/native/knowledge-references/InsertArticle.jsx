import React, {useEffect,useState} from 'react';
import {nativeRequest} from '../transport';
import './knowledge-references.css';

export default function InsertArticle({projectId,onInserted,disabled}) {
    const [open,setOpen]=useState(false),[articles,setArticles]=useState(null),[articleId,setArticleId]=useState('');
    const [busy,setBusy]=useState(false),[error,setError]=useState('');
    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();setArticles(null);setError('');
        nativeRequest(`/api/knowledge/${encodeURIComponent(projectId)}/articles`,{signal:controller.signal}).then(result => {
            if (!controller.signal.aborted) setArticles(result.data || result);
        }).catch(failure => {if (!controller.signal.aborted) setError(failure.message);});
        return () => controller.abort();
    },[projectId,open]);
    const insert = async mode => {
        setBusy(true);setError('');
        try {
            const result = await nativeRequest(`/api/knowledge/${encodeURIComponent(projectId)}/references/insert`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({articleId,mode})});
            onInserted(result);setOpen(false);setArticleId('');
        } catch (failure) {setError(failure.message);} finally {setBusy(false);}
    };
    return <section className="knowledge-article-insert" aria-label="Insert article into saved reply">
        <button type="button" className="btn btn-white" disabled={disabled || busy} aria-expanded={open} onClick={() => setOpen(current => !current)}>Insert article</button>
        {open && <>
            <p className="settings-note">Choose an article reference. Each target ticket’s recipients are checked when this saved reply is applied and sent.</p>
            {error && <p role="alert" className="text-danger">{error}</p>}
            {!articles && !error && <p role="status">Loading articles…</p>}
            {articles && <div className="knowledge-article-insert__controls"><div className="form-group"><label className="form-label" htmlFor="saved-reply-article">Article</label><select id="saved-reply-article" className="form-select" value={articleId} disabled={busy} onChange={event => setArticleId(event.target.value)}><option value="">Choose a published article</option>{articles.map(article => <option key={article.id} value={article.id} disabled={article.status !== 'published'}>{article.title}</option>)}</select></div><button type="button" className="btn btn-white" disabled={!articleId || busy} onClick={() => insert('link')}>Insert link</button><button type="button" className="btn btn-white" disabled={!articleId || busy} onClick={() => insert('text')}>Insert text</button></div>}
        </>}
    </section>;
}
