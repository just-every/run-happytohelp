import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { tooltip } from '../../../modules/tooltip/tooltip';

const scopes = [ [ 'all', 'All history' ], [ 'view', 'This view' ] ];

/** The search field. While a query is typed, "All history / This view" chooses what it searches; choosing runs it. */
export default function InboxSearch({ query, scope, onSearch }) {
    const [ value, setValue ] = useState(query);
    // The chosen scope shows at once; the URL catches up when its search runs.
    const [ chosen, setChosen ] = useState(scope);

    useEffect(() => {
        setValue(query);
    }, [ query ]);

    useEffect(() => {
        setChosen(scope);
    }, [ scope ]);

    const submit = event => {
        event.preventDefault();
        onSearch(value, chosen);
    };

    return (
        <form className="search-query" onSubmit={ submit }>
            <div className="input-group">
                <input
                    type="search"
                    value={ value }
                    onChange={ event => setValue(event.target.value) }
                    className="form-control form-control-lg bg-white"
                    placeholder="Search messages or customers…"
                    aria-label="Search conversations by message, name or email" />
                <div className="input-group-append">
                    <button className="btn btn-lg btn-ico btn-secondary btn-minimal bg-white" type="submit" { ...tooltip('Search conversations') }>
                        <i className="fe fe-search" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
            { value.trim() && <div className="inbox-search-scope" role="radiogroup" aria-label="Conversation search scope">
                { scopes.map(([ option, label ]) => <label key={ option } className="inbox-search-scope-option">
                    <input type="radio" name="inbox-search-scope" value={ option } checked={ chosen === option } onChange={ () => { setChosen(option); onSearch(value, option); } } />
                    <span>{ label }</span>
                </label>) }
            </div> }
        </form>
    );
}

InboxSearch.propTypes = {
    query: PropTypes.string,
    scope: PropTypes.oneOf([ 'all', 'view' ]).isRequired,
    onSearch: PropTypes.func.isRequired,
};

InboxSearch.defaultProps = {
    query: '',
};
