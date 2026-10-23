import React, {useContext, useEffect, useState, useRef} from 'react';
import {ConnectContext} from './context/ConnectContext';
import {recoveryCopy} from '../../outcomes/recovery-copy';
import {ratingCopy} from './rating-copy';

export default function ResolutionRating() {
    const form = useRef(null);
    const {resolution, setResolution, sendMessage} = useContext(ConnectContext);
    const [value, setValue] = useState(null), [comment, setComment] = useState(''), [recovery, setRecovery] = useState('unknown');
    const [saving, setSaving] = useState(false), [error, setError] = useState(''), [now, setNow] = useState(Date.now());
    const survey = resolution?.survey, scale = survey?.scale || 'thumbs';
    const storedScore = resolution?.rating?.scale === scale ? resolution.rating.score : resolution?.rating?.value;
    const copy = ratingCopy[survey?.locale] || ratingCopy.en, recoveryText = recoveryCopy[survey?.locale] || recoveryCopy.en;
    useEffect(() => {
        setValue(storedScore ?? null);
        setComment(resolution?.rating?.comment || '');
        setRecovery(resolution?.rating?.recovery || 'unknown');
        setError('');
        setNow(Date.now());
    }, [resolution?.id, resolution?.rating?.revision, storedScore]);
    useEffect(() => {
        const next = [survey?.availableAt, survey?.expiresAt].filter(at => at > now).sort((a, b) => a - b)[0];
        if (!next) return;
        const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(1, next - Date.now())));
        return () => clearTimeout(timer);
    }, [resolution?.id, survey?.availableAt, survey?.expiresAt, now]);
    useEffect(() => { if (resolution?.id) form.current?.scrollIntoView({block: 'nearest'}); }, [resolution?.id, now >= (survey?.availableAt || 0)]);
    if (!resolution) return null;
    if (survey?.optedOut) return <p role="status" className="happytohelp-resolution-rating" lang={survey.locale}>{copy.stopped}</p>;
    if (survey && (!survey.enabled || now < survey.availableAt || survey.expiresAt && now >= survey.expiresAt)) return null;
    const save = async event => {
        event.preventDefault(); setSaving(true); setError('');
        try {
            const result = await sendMessage('rateResolution', {resolutionId: resolution.id, score: value, comment, recovery});
            setResolution(result.resolution);
        } catch (failure) { setError(failure.message || copy.error); }
        finally { setSaving(false); }
    };
    const stop = async () => {
        setSaving(true); setError('');
        try { setResolution((await sendMessage('optOutResolutionSurveys', {resolutionId: resolution.id})).resolution); }
        catch (failure) { setError(failure.message || copy.error); }
        finally { setSaving(false); }
    };
    const unchanged = value === storedScore && comment === resolution.rating?.comment && recovery === (resolution.rating?.recovery || 'unknown');
    return <form ref={form} className="happytohelp-resolution-rating" onSubmit={save} aria-label={copy.label} lang={survey?.locale || 'en'}>
        <p><strong>{copy.question}</strong></p>
        <div className="happytohelp-rating-options">
            {(scale === 'five' ? [1, 2, 3, 4, 5] : [1, -1]).map(score => <button key={score} type="button" aria-label={scale === 'five' ? `${score} / 5` : undefined} aria-pressed={value === score} disabled={saving} onClick={() => setValue(score)}>{scale === 'five' ? `${score} / 5` : score === 1 ? copy.yes : copy.no}</button>)}
        </div>
        <label htmlFor="happytohelp-recovery">{recoveryText.question}</label>
        <select id="happytohelp-recovery" value={recovery} disabled={saving} onChange={event => setRecovery(event.target.value)}>{['unknown','recovered','not_recovered'].map(answer => <option key={answer} value={answer}>{recoveryText[answer]}</option>)}</select>
        <label htmlFor="happytohelp-rating-comment">{copy.comment}</label>
        <textarea id="happytohelp-rating-comment" name="rating_comment" maxLength={1000} rows={2} value={comment} onChange={event => setComment(event.target.value)} disabled={saving} aria-describedby="happytohelp-rating-count"/>
        <span id="happytohelp-rating-count" className="happytohelp-rating-count">{comment.length}/1,000</span>
        <button type="submit" disabled={saving || value === null || unchanged}>{saving ? copy.saving : resolution.rating ? copy.update : copy.send}</button>
        <button type="button" disabled={saving} onClick={stop}>{copy.stop}</button>
        {resolution.rating && <p role="status">{copy.thanks}</p>}
        {error && <p role="alert">{error}</p>}
    </form>;
}
