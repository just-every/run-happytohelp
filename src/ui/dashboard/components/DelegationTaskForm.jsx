import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import TextareaAutosize from 'react-textarea-autosize';
import { isWorkerReady } from '../utils/localAgentSetup';

const modes = [
    { id: 'investigate', label: 'Investigate' },
    { id: 'resolve', label: 'Resolve' },
    { id: 'resolve_reply', label: 'Resolve & reply' },
];

const providerName = provider => provider === 'claude' ? 'Claude' : 'Codex';
const usableDevice = device => !device.revoked_at;

export default function DelegationTaskForm({ devices, isSubmitting, onSubmit, preferredDeviceId }) {
    const [ deviceId, setDeviceId ] = useState('');
    const [ mode, setMode ] = useState('investigate');
    const [ instructions, setInstructions ] = useState('');
    const [ timeLimit, setTimeLimit ] = useState(15);
    const appliedPreferredDeviceId = useRef(null);
    const usableDevices = useMemo(() => devices.filter(usableDevice), [ devices ]);
    const selectedDevice = usableDevices.find(device => device.id === deviceId) || null;
    const selectedIsReady = isWorkerReady(selectedDevice);

    useEffect(() => {
        const preferred = usableDevices.find(device => device.id === preferredDeviceId);
        const current = usableDevices.find(device => device.id === deviceId);
        const ready = usableDevices.find(isWorkerReady);
        if (preferred && appliedPreferredDeviceId.current !== preferredDeviceId) {
            appliedPreferredDeviceId.current = preferredDeviceId;
            setDeviceId(preferred.id);
            return;
        }

        const next = current || ready || usableDevices[0] || null;
        if (next?.id && next.id !== deviceId) setDeviceId(next.id);
        if (!next && deviceId) setDeviceId('');
    }, [ deviceId, preferredDeviceId, usableDevices ]);

    const submit = async event => {
        event.preventDefault();
        const scope = instructions.trim();
        if (!deviceId || !scope || isSubmitting) return;

        try {
            await onSubmit({ deviceId, mode, instructions: scope, timeLimitMinutes: timeLimit });
            setInstructions('');
        } catch (error) {
            // The panel owns the server error message so it stays beside every state.
        }
    };

    return <form className="delegation-task-form" onSubmit={ submit } aria-label="Delegate this conversation">
        <div className="delegation-section-heading">
            <span className="delegation-section-icon"><i className="fe fe-send" aria-hidden="true" /></span>
            <div>
                <h3>New task</h3>
                <p>Choose the outcome, then give the worker a focused instruction.</p>
            </div>
        </div>

        <label className="delegation-field" htmlFor="delegation-device">
            <span>Worker</span>
            <select id="delegation-device" value={ deviceId } onChange={ event => setDeviceId(event.target.value) } disabled={ !usableDevices.length || isSubmitting }>
                { !usableDevices.length && <option value="">Set up a worker first</option> }
                { usableDevices.map(device => <option key={ device.id } value={ device.id }>
                    { device.name || providerName(device.provider) } · { providerName(device.provider) } { isWorkerReady(device) ? '(ready)' : '(queues)' }
                </option>) }
            </select>
        </label>

        { selectedDevice && <p className={ 'delegation-task-form__worker-state' + (selectedIsReady ? ' is-ready' : '') }>
            <i className={ selectedIsReady ? 'fe fe-check-circle' : 'fe fe-clock' } aria-hidden="true" />
            { selectedIsReady
                ? 'Worker is ready to receive this task.'
                : 'This task will queue until its worker starts.' }
        </p> }

        <label className="delegation-field" htmlFor="delegation-mode">
            <span>Action</span>
            <select id="delegation-mode" value={ mode } onChange={ event => setMode(event.target.value) } disabled={ isSubmitting || !usableDevices.length }>
                { modes.map(option => <option key={ option.id } value={ option.id }>{ option.label }</option>) }
            </select>
        </label>

        <label className="delegation-field delegation-field--instructions" htmlFor="delegation-instructions">
            <span>Instructions</span>
            <TextareaAutosize
                id="delegation-instructions"
                value={ instructions }
                onChange={ event => setInstructions(event.target.value) }
                placeholder="Describe the work, limits, and outcome you need."
                minRows={ 4 }
                maxRows={ 12 }
                maxLength={ 12000 }
                disabled={ isSubmitting || !usableDevices.length }
            />
            <small>{ instructions.length.toLocaleString() } / 12,000</small>
        </label>
        <label className="delegation-field" htmlFor="delegation-time-limit">
            <span id="delegation-time-label">Task authority (minutes)</span>
            <input id="delegation-time-limit" aria-labelledby="delegation-time-label" type="number" min={1} max={15} step={1} required value={timeLimit} onChange={event => setTimeLimit(Number(event.target.value))} disabled={isSubmitting} aria-describedby="delegation-time-help"/>
            <small id="delegation-time-help">Starts when you send the task, including queue time. Up to 15 minutes; retries and additional input never extend it. Expiry withdraws authority and requests a stop; the local outcome remains unconfirmed.</small>
        </label>
        { mode === 'resolve_reply' && <p className="delegation-delivery-notice">
            <i className="fe fe-shield" aria-hidden="true" /> A customer reply is sent only after the worker reports verified work.
        </p> }
        <button type="submit" className="btn btn-primary delegation-submit" disabled={ isSubmitting || !deviceId || !instructions.trim() }>
            { isSubmitting ? <span className="spinner-border spinner-border-sm" aria-hidden="true" /> : <i className="fe fe-send" aria-hidden="true" /> }
            { isSubmitting ? 'Sending…' : selectedIsReady ? 'Send task' : 'Queue task' }
        </button>
    </form>;
}

DelegationTaskForm.propTypes = {
    devices: PropTypes.arrayOf(PropTypes.object).isRequired,
    isSubmitting: PropTypes.bool,
    onSubmit: PropTypes.func.isRequired,
    preferredDeviceId: PropTypes.string,
};
