import React, {useId, useState} from 'react';
import {Alert, Button, Form, Modal} from 'react-bootstrap';
import useCollaboration from './useCollaboration';
import './followers-dialog.css';

/** Internal CC: choose the teammates who follow this ticket. Followers get its updates; the customer never sees them. */
export default function FollowersDialog({onHide}) {
    const collaboration = useCollaboration();
    const titleId = useId(), listId = useId();
    const [selected, setSelected] = useState(() => collaboration.followers.map(member => member.id));
    const [query, setQuery] = useState('');
    const needle = query.trim().toLowerCase();
    const visible = collaboration.members.filter(member => !needle || String(member.name || '').toLowerCase().includes(needle));
    const close = collaboration.busy ? undefined : onHide;
    const save = async () => { if (await collaboration.setFollowers(selected)) onHide(); };
    return <Modal show onHide={close} aria-labelledby={titleId} className="followers-dialog">
        <Modal.Header closeButton={!collaboration.busy}><Modal.Title id={titleId}>Internal CC</Modal.Title></Modal.Header>
        <Modal.Body>
            {collaboration.error && <Alert variant="danger" role="alert">{collaboration.error}</Alert>}
            <p>Teammates who follow this ticket get its updates. They are internal CCs: the customer never sees them.</p>
            <Form.Control type="search" aria-label="Find a teammate" placeholder="Find a teammate" value={query} onChange={event => setQuery(event.target.value)} disabled={collaboration.busy}/>
            <fieldset className="followers-dialog__list" aria-describedby={listId} disabled={collaboration.busy}>
                <legend>Teammates following this ticket</legend>
                {visible.map(member => <Form.Check key={member.id} id={`${listId}-${member.id}`} label={member.name} checked={selected.includes(member.id)}
                    onChange={event => setSelected(current => event.target.checked ? [...current, member.id] : current.filter(id => id !== member.id))}/>)}
                <p id={listId} className="followers-dialog__count">{selected.length === 1 ? '1 teammate selected.' : `${selected.length} teammates selected.`}{needle && !visible.length ? ` No teammate matches “${query.trim()}”.` : ''}</p>
            </fieldset>
        </Modal.Body>
        <Modal.Footer>
            <Button variant="secondary" disabled={collaboration.busy} onClick={onHide}>Cancel</Button>
            <Button disabled={collaboration.busy} onClick={save}>{collaboration.busy ? 'Saving…' : 'Save followers'}</Button>
        </Modal.Footer>
    </Modal>;
}
