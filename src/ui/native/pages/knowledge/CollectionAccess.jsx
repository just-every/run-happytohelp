import React, {useEffect,useState} from 'react';
import CollectionEntitlements from './CollectionEntitlements';

export const collectionVisibility = collection => collection.audience === 'domains' || collection.requires_entitlement ? 'selected' : collection.audience || 'public';
export const audienceLabel = collection => ({public:'Public', 'signed-in':'Signed-in customers', selected:'Selected customers and companies'})[collectionVisibility(collection)];

export default function CollectionAccess({projectId,draft,change}) {
    const [grants,setGrants] = useState(null);
    const visibility = collectionVisibility(draft);
    useEffect(() => setGrants(null),[draft.id,draft.updated_at]);
    const select = (_,value) => {
        change('audience',value === 'selected' ? 'signed-in' : value);
        change('requires_entitlement',value === 'selected');
        if (grants) {
            change('entitlementContactIds',draft.entitlementContactIds ?? grants.accounts.map(account => account.id));
            change('entitlementCompanyIds',draft.entitlementCompanyIds ?? grants.companies.map(company => company.id));
        }
    };
    return <fieldset className="knowledge-governance-group">
        <legend>Collection access</legend>
        <div className="form-group"><label className="form-label" htmlFor="collection-visibility">Who can read this collection?</label><select id="collection-visibility" className="form-select" value={visibility} onChange={event => select('audience',event.target.value)}><option value="public">Public</option><option value="signed-in">Signed-in customers</option><option value="selected">Selected customers and companies</option></select></div>
        {draft.id ? <CollectionEntitlements {...{projectId,draft,change}} selected={visibility === 'selected'} onLoaded={setGrants}/> : visibility === 'selected' && <p className="settings-note">Create this collection, then select customers and companies. Until grants are saved, no customers can read it.</p>}
        <p className="settings-note">Applies to articles in this collection and its child collections, including search results and AI answers. Publishing a collection does not override its access rules.</p>
    </fieldset>;
}
