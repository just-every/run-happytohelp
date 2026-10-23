import React, { useId, useState } from 'react';
import { tooltip } from '../../../../modules/tooltip/tooltip';

// An article's categories as aqua chips in one field, each with its remove button, and an inline input that adds any
// existing category by name (the browser suggests them as you type).
export default function CategoryChips({ id, categories, value = [], onChange }) {
    const [text, setText] = useState('');
    const listId = useId();
    const name = category => category.title || category.name;
    const selected = value.map(categoryId => categories.find(category => String(category.id) === String(categoryId))).filter(Boolean);
    const available = categories.filter(category => !value.some(categoryId => String(categoryId) === String(category.id)));
    const add = typed => {
        const match = available.find(category => name(category).toLowerCase() === typed.trim().toLowerCase());
        if (!match) return false;
        onChange([...value, match.id]);
        setText('');
        return true;
    };
    return <><div className="category-chips form-control">
        {selected.map(category => <span className="h2h-chip category-chips__chip" key={category.id}>{name(category)}
            <button type="button" {...tooltip('Remove category')} onClick={() => onChange(value.filter(categoryId => String(categoryId) !== String(category.id)))}><i className="fe fe-x" aria-hidden="true"/></button>
        </span>)}
        <input id={id} list={listId} value={text} placeholder="Add a category…" autoComplete="off" disabled={!available.length}
            onChange={event => { if (!add(event.target.value)) setText(event.target.value); }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(text); } }}/>
        <datalist id={listId}>{available.map(category => <option key={category.id} value={name(category)}/>)}</datalist>
    </div>{!categories.length && <div className="form-text">No categories yet. Add one in the Categories tab above, then choose it here.</div>}</>;
}
