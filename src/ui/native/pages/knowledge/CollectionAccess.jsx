import React from 'react';
import CollectionEntitlements from './CollectionEntitlements';
import { Field } from '../forms';

export const audienceLabel = collection => collection.requires_entitlement ? `Named accounts only (${collection.entitlementContactIds?.length ?? collection.entitlement_count ?? 0})` : ({public: 'Public', 'signed-in': 'Signed-in customers', domains: 'Selected email domains'})[collection.audience] || 'Public';

export default function CollectionAccess({ projectId, draft, change }) {
    const domains = Array.isArray(draft.allowedDomains) ? draft.allowedDomains.join('\n') : draft.allowedDomains || '';
    return <fieldset className="knowledge-governance-group">
        <legend>Collection access</legend>
        <p className="settings-note">{audienceLabel(draft)}</p>
        <Field name="audience" label={draft.requires_entitlement ? "Additional sign-in requirement" : "Who can read this collection?"} value={draft.audience || 'public'} onChange={(name,value)=>{change(name,value);if(value==='public'&&draft.requires_entitlement){change('requires_entitlement',false);change('entitlementContactIds',[])}}} options={[
            {value: 'public', label: 'Anyone (public)'},
            {value: 'signed-in', label: 'Signed-in customers'},
            {value: 'domains', label: 'Customers with selected email domains'},
        ]}/>
        {draft.audience === 'domains' && <Field name="allowedDomains" label="Allowed email domains" type="textarea" rows={3} value={domains} onChange={change} required hint="Enter one domain per line, such as example.com. Customers must sign in with a verified email address from an allowed domain."/>}
        {draft.id && <CollectionEntitlements {...{projectId,draft,change}}/>}
        <p className="settings-note">Applies to articles in this collection and its child collections, including search results and AI answers. Publishing a collection does not override its access rules.</p>
    </fieldset>;
}
