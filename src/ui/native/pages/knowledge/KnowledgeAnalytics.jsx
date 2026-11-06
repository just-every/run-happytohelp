import React, { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { nativeRequest } from '../../transport';
import { Field } from '../forms';

const number = value => Number(value || 0).toLocaleString();

export default function KnowledgeAnalytics({ projectId }) {
    const [data, setData] = useState(null);
    const [locale, setLocale] = useState('');
    const [brand, setBrand] = useState('');
    const [locales, setLocales] = useState([]);
    const [filter, setFilter] = useState({locale: '', brand: ''});
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let active = true;
        nativeRequest(`/api/knowledge/${projectId}/experience`).then(result => { if (active) setLocales(result.locales); }).catch(e => { if (active) setError(e.message); });
        return () => { active = false; };
    }, [projectId]);
    useEffect(() => {
        let active = true;
        setLoading(true); setError(''); setData(null);
        const query = new URLSearchParams();
        if (filter.locale) query.set('locale', filter.locale);
        if (filter.brand) query.set('brand', filter.brand);
        nativeRequest(`/api/knowledge/${projectId}/analytics?${query}`).then(result => { if (active) setData(result); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [projectId, filter]);
    const totalSearches = data?.searches.reduce((total, row) => total + Number(row.searches), 0) || 0;
    const withoutResults = data?.searches.reduce((total, row) => total + Number(row.withoutResults), 0) || 0;
    return <section className="knowledge-analytics">
        <h2>Article analytics</h2>
        <p className="settings-note">Recorded Help Center activity for this workspace. Filter by the locale and brand recorded with each visit.</p>
        <form className="knowledge-analytics-filters" onSubmit={event => { event.preventDefault(); setFilter({locale, brand: brand.trim()}); }}>
            <Field name="analytics-locale" label="Locale" value={locale} onChange={(_, value) => setLocale(value)} options={[{value: '', label: 'All locales'}, ...locales.map(value => ({value, label: value}))]}/>
            <Field name="analytics-brand" label="Brand" value={brand} onChange={(_, value) => setBrand(value)} hint="Leave empty for all brands."/>
            <button className="btn btn-white" disabled={loading}>{loading ? 'Loading…' : 'Apply filters'}</button>
        </form>
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        {loading && <p role="status">Loading analytics…</p>}
        {data && <>
            <dl className="knowledge-metrics">
                {[[data.totals.views, 'Article views'], [totalSearches, 'Searches'], [withoutResults, 'Searches without results'], [data.totals.clicks, 'Article clicks'], [data.totals.helpful, 'Helpful votes'], [data.totals.unhelpful, 'Not helpful votes'], [data.totals.tickets, 'Tickets from article request links']].map(([value, label]) => <div key={label}><dt>{label}</dt><dd>{number(value)}</dd></div>)}
            </dl>
            <h3>Articles and helpfulness</h3>
            {data.articles.length === 0 ? <p>No article activity recorded for these filters.</p> : <div className="table-responsive"><table className="table knowledge-table stack-table"><thead><tr><th>Article</th><th>Views</th><th>Clicks</th><th>Helpful / not helpful</th><th>Tickets from article request links</th></tr></thead><tbody>{data.articles.map(row => <tr key={row.articleId}>
                <td data-label="Article"><Link to={`/projects/${projectId}/articles/${row.articleId}`}>{row.title}</Link></td><td data-label="Views">{number(row.views)}</td><td data-label="Clicks">{number(row.clicks)}</td><td data-label="Helpful / not helpful">{number(row.helpful)} / {number(row.unhelpful)}</td><td data-label="Tickets from article request links">{number(row.tickets)}</td>
            </tr>)}</tbody></table></div>}
            <h3 className="mt-4">Search terms</h3>
            <p className="settings-note">Click-through counts article clicks attributed to each search term. Repeated clicks are counted separately.</p>
            {data.searches.length === 0 ? <p>No searches recorded for these filters.</p> : <div className="table-responsive"><table className="table knowledge-table stack-table"><thead><tr><th>Search term</th><th>Locale / brand</th><th>Searches</th><th>With results</th><th>Without results</th><th>Click-through</th></tr></thead><tbody>{data.searches.map((row, index) => <tr key={`${row.query}-${row.locale}-${row.brand}-${index}`}>
                <td data-label="Search term">{row.query}</td><td data-label="Locale / brand">{row.locale || 'Default'}<small>{row.brand || 'Unspecified'}</small></td><td data-label="Searches">{number(row.searches)}</td><td data-label="With results">{number(row.withResults)}</td><td data-label="Without results">{number(row.withoutResults)}</td><td data-label="Click-through">{number(row.clicks)} clicks</td>
            </tr>)}</tbody></table></div>}
            <h3 className="mt-4">Reader comments</h3>
            {data.comments.length === 0 ? <p>No feedback comments recorded for these filters.</p> : <div className="table-responsive"><table className="table knowledge-table stack-table"><thead><tr><th>Article</th><th>Helpful?</th><th>Comment</th><th>Submitted</th></tr></thead><tbody>{data.comments.map((row, index) => <tr key={`${row.articleId}-${row.created_at}-${index}`}>
                <td data-label="Article"><Link to={`/projects/${projectId}/articles/${row.articleId}`}>{row.title}</Link></td><td data-label="Helpful?">{row.helpful ? 'Yes' : 'No'}</td><td data-label="Comment">{row.comment}</td><td data-label="Submitted">{new Date(row.created_at).toLocaleString()}</td>
            </tr>)}</tbody></table></div>}
        </>}
    </section>;
}
