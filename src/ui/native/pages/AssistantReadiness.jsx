import React, {useEffect, useState} from 'react';
import ProviderSetupNotice from '../activation/ProviderSetupNotice';
import {nativeRequest} from '../transport';

/** What the Setup snapshot states that this page's sentences depend on: whether the installed key's provider can be
 *  checked automatically (`facts.ai.checkable`) and which assistant, if any, was provisioned as the starter
 *  (`facts.starterAssistant`). A read only: the snapshot's GET never calls a provider. Null until known, and for a
 *  member who cannot open the Setup page (owners and admins only). */
function useSetupFacts(projectId, status) {
    const [facts, setFacts] = useState(null);
    useEffect(() => {
        let active = true;
        setFacts(null);
        if (status?.assistant) nativeRequest(`/api/management/projects/${encodeURIComponent(projectId)}/activation`, {cache: 'no-store'})
            .then(({data}) => { if (active) setFacts({checkable: Boolean(data.facts.ai.checkable), starterId: data.facts.starterAssistant?.id ?? null}); }, () => {});
        return () => { active = false; };
    }, [projectId, status]);
    return facts;
}

/** What the installed key lets the assistant do under the workspace's AI reply mode. */
const modeEffect = {auto: 'answers new visitor conversations by itself, within your daily limits.', draft: 'writes drafts for your team; it sends nothing to visitors.', off: 'stays idle while AI is off.'};

/** Whether the default visitor assistant can answer: the key it is waiting for, or that it is installed. Read from
 *  `GET .../ai` (presence only; no key material ever reaches the browser). */
export default function AssistantReadiness({projectId, status}) {
    const facts = useSetupFacts(projectId, status), checkable = status?.ready ? facts?.checkable ?? null : null;
    if (!status) return null;
    const {assistant, ready, secretName, providerLabel} = status;
    if (!assistant) return <ProviderSetupNotice projectId={projectId}/>;
    if (ready) return <p className="settings-note" role="status" data-testid="ai-key-status" data-state="present"><i className="fe fe-check" aria-hidden="true"/> {secretName ? <code>{secretName}</code> : `The ${providerLabel} key`} is installed, so {assistant.name} {modeEffect[status.ai_reply_mode] ?? modeEffect.auto}{checkable === true && ' The Setup page checks it with the provider and shows the result.'}{checkable === false && ` ${providerLabel} offers no automatic key check, so the Setup page lists it as installed but not confirmed.`}</p>;
    return <div data-testid="ai-key-status" data-state="missing">
        <p role="status"><strong>{secretName ? <><code>{secretName}</code> isn’t installed.</> : `The ${providerLabel} key isn’t installed.`}</strong> {facts?.starterId && facts.starterId === assistant.id ? 'Your starter assistant' : 'Your default assistant'}, {assistant.name}, can’t answer visitors until it is. Add it as an installation secret. Until then, new conversations stay with your team.</p>
        <ProviderSetupNotice projectId={projectId} secretName={secretName}/>
    </div>;
}
