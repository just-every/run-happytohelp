import React, { useEffect, useId, useState } from 'react';
import { nativeRequest } from '../transport';
import { spendPresentation, usd } from './spend-model';
import './spend.css';
import {dailySafetyLimit} from '../setup-help/ai-billing';

/** AI spend for the day: one line and the Refresh button. The scope, counts, caveats and the automatic-reply guards sit in a
 *  disclosure; a reached ceiling stays visible outside it. */
export default function AiSpendCard({ projectId }) {
 const heading = useId();
 const [result, setResult] = useState(null), [error, setError] = useState(null), [revision, setRevision] = useState(0);
 useEffect(() => {
  let active = true;
  setResult(null); setError(null);
  if (projectId) nativeRequest(`/api/dashboard/projects/${encodeURIComponent(projectId)}/ai-spend`)
   .then(({ data }) => { if (active) setResult({ projectId, data }); })
   .catch(failure => { if (active) setError({ projectId, message: failure.message }); });
  return () => { active = false; };
 }, [projectId, revision]);
 // Never flash the previous workspace's spend during project navigation.
 const data = result?.projectId === projectId ? result.data : null;
 const failure = error?.projectId === projectId ? error.message : null;
 const presentation = data && spendPresentation(data.spend);
 return <section className="activation-spend h2h-card" aria-labelledby={heading}>
  <div className="activation-spend__header">
   <h2 id={heading}>AI spend</h2>
   {data && <p className="activation-spend__summary" data-testid="spend-summary">{presentation.summary}</p>}
   <button type="button" className="btn btn-sm btn-white" disabled={!projectId || (!data && !failure)} onClick={() => setRevision(value => value + 1)}>Refresh spend</button>
  </div>
  {!projectId ? <p>Select a workspace to view AI spend.</p> : failure ? <p role="alert">Could not load AI spend: {failure}</p> : !data ? <p role="status">Loading AI spend…</p> : <>
   <h3>Daily safety limit</h3><p>{dailySafetyLimit(data.automatic.replies.limit, data.automatic.spendUsd.limit, data.automatic.installationReplies.limit, data.resetsAt.slice(11, 16))}</p>
   {data.automatic.replyCeilingReached && <p role="status">Automatic replies are paused: a daily ceiling has been reached.</p>}
   {data.automatic.installationCeilingReached && <p>The installation reply ceiling has been reached across workspaces.</p>}
   {data.contextRuns.ceilingReached && <p>Visitor context runs are paused at their daily ceiling.</p>}
   <details className="activation-spend__details" data-testid="spend-details">
    <summary>Details and guards</summary>
    <p className="activation-spend__scope">This workspace · {data.day} UTC · Conversation AI</p>
    <p className="activation-spend__note">Actual provider cost (USD)</p><p className="activation-spend__amount">{presentation.amount}</p><p>{presentation.label}</p>
    <p>{data.spend.generations} generations · {data.spend.knownRounds} rounds with actual cost · {data.spend.unknownRounds} rounds without actual cost</p>
    {data.spend.unmeasuredGenerations > 0 && <p>{data.spend.unmeasuredGenerations} generations have no recorded round usage.</p>}
    {data.spend.inProgressGenerations > 0 && <p>{data.spend.inProgressGenerations} generations are running or uncertain; further usage may be unreported.</p>}
    {data.spend.pendingGenerations > 0 && <p>{data.spend.pendingGenerations} queued generations have not started.</p>}
    {data.spend.unverifiedRounds > 0 && <p>Estimated recorded cost (USD): {usd(data.spend.unverifiedUsd)} across {data.spend.unverifiedRounds} rounds. No provider USD receipts are retained for these rounds. Token-price estimates, including zero, do not establish actual billing.</p>}
    <p className="activation-spend__note">Includes automatic replies and team generations started on this UTC day. Excludes customer context, evaluation/training, separate image generation, local computers and other provider account activity. This is not total workspace or account spend.</p>
    <h3>Automatic reply guards</h3>
    <dl className="activation-spend__limits"><div><dt>Replies admitted</dt><dd>{data.automatic.replies.used} / {data.automatic.replies.limit}</dd></div><div><dt>Recorded cost counter / USD ceiling</dt><dd>{usd(data.automatic.spendUsd.used)} / {usd(data.automatic.spendUsd.limit)}</dd></div><div><dt>Replies skipped</dt><dd>{data.automatic.skippedReplies}</dd></div><div><dt>Visitor context runs</dt><dd>{data.contextRuns.used} / {data.contextRuns.limit}</dd></div></dl>
    <p className="activation-spend__note">The automatic reply counter may contain estimates and excludes missing costs; zero does not prove zero spend. These runtime guards are not provider billing caps. {data.ceilingDefaults.length ? 'Some or all guards use installation defaults.' : 'The installation overrides all guard defaults.'}</p>
    <p>Daily guards reset <time dateTime={data.resetsAt}>{data.resetsAt.replace('T', ' ').replace('.000Z', ' UTC')}</time>.</p>
   </details>
  </>}
 </section>;
}
