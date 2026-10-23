import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Modal } from 'react-bootstrap';
import DelegationCopyButton from './DelegationCopyButton';
import DelegationDevices from './DelegationDevices';
import { buildLocalAgentCommands, isWorkerReady, pairedDevice } from '../utils/localAgentSetup';
import DialogHeader from './DialogHeader';

const remainingSeconds = expiresAt => {
    const expiresAtTime = new Date(expiresAt).getTime();
    if (Number.isNaN(expiresAtTime)) return 0;
    return Math.max(0, Math.ceil((expiresAtTime - Date.now()) / 1000));
};

const formatRemaining = seconds => String(Math.floor(seconds / 60)) + ':' + String(seconds % 60).padStart(2, '0');
const providerName = provider => provider === 'claude' ? 'Claude' : 'Codex';

const serverOrigin = () => {
    if (typeof window === 'undefined') return '';
    try {
        return new URL(window.chatSettings?.apiUrl || window.location.origin, window.location.origin).origin;
    } catch (error) {
        return window.location.origin;
    }
};

export default function DelegationPairing({
    createPairing,
    devices,
    error,
    isOpen,
    onHide,
    onPairingExpired,
    onRefresh,
    onRevoke,
    onWorkerReady,
    pairing,
    projectId,
}) {
    const [ provider, setProvider ] = useState('codex');
    const [ name, setName ] = useState('My HappyToHelp computer');
    const [ isCreating, setIsCreating ] = useState(false);
    const [ secondsLeft, setSecondsLeft ] = useState(() => remainingSeconds(pairing?.expires_at));
    const dialogBodyRef = useRef(null);
    const setupActionRef = useRef(null);
    const previousFocusKey = useRef(null);

    useEffect(() => {
        setSecondsLeft(remainingSeconds(pairing?.expires_at));
        if (!pairing?.expires_at) return undefined;

        const timer = window.setInterval(() => {
            const nextSeconds = remainingSeconds(pairing.expires_at);
            setSecondsLeft(nextSeconds);
            if (nextSeconds === 0) onPairingExpired?.();
        }, 1000);

        return () => window.clearInterval(timer);
    }, [ onPairingExpired, pairing?.expires_at ]);

    const currentPairing = pairing && secondsLeft > 0 ? pairing : null;
    const matchedDevice = pairedDevice(devices, currentPairing?.id);
    const modernDevice = devices.find(device => !device.revoked_at && device.pairing_id) || null;
    // While a new pairing is open, readiness applies only to its matching
    // device. An older worker must not consume the new pairing's success state.
    const selectedDevice = currentPairing ? matchedDevice : modernDevice;
    const deviceReady = isWorkerReady(selectedDevice);
    // Pairing is single-use as soon as a matching device exists. The worker
    // may still be stopped, but the old setup code must never be offered again.
    const pairingConsumed = Boolean(currentPairing && matchedDevice);
    const restartDevice = pairingConsumed ? matchedDevice : modernDevice;
    const focusKey = (currentPairing?.id || 'no-pairing') + ':' + (pairingConsumed ? 'consumed' : 'open');
    const origin = serverOrigin();
    const setup = useMemo(() => {
        if (!currentPairing?.code) return null;
        try {
            return buildLocalAgentCommands({
                origin,
                projectId,
                provider,
                name,
                code: currentPairing.code,
            });
        } catch (setupError) {
            return null;
        }
    }, [ currentPairing?.code, name, origin, projectId, provider ]);
    const sessionSetup = useMemo(() => {
        if (!currentPairing?.code) return null;
        try {
            return buildLocalAgentCommands({
                origin,
                projectId,
                provider,
                name,
                code: currentPairing.code,
                session: true,
            });
        } catch (setupError) {
            return null;
        }
    }, [ currentPairing?.code, name, origin, projectId, provider ]);
    const restartSetup = useMemo(() => {
        if (!restartDevice || (currentPairing && !pairingConsumed)) return null;
        try {
            return buildLocalAgentCommands({
                origin,
                projectId,
                provider: restartDevice.provider || 'codex',
                name: restartDevice.name,
                code: '',
            });
        } catch (setupError) {
            return null;
        }
    }, [ currentPairing, origin, pairingConsumed, projectId, restartDevice ]);

    useEffect(() => {
        if (matchedDevice && isWorkerReady(matchedDevice)) onWorkerReady?.(matchedDevice.id);
    }, [ matchedDevice, onWorkerReady ]);

    useEffect(() => {
        if (!isOpen) {
            previousFocusKey.current = null;
            return undefined;
        }
        if (previousFocusKey.current === null) {
            previousFocusKey.current = focusKey;
            return undefined;
        }
        if (previousFocusKey.current === focusKey) return undefined;

        previousFocusKey.current = focusKey;
        const frame = window.requestAnimationFrame(() => {
            if (dialogBodyRef.current?.contains(setupActionRef.current)) {
                setupActionRef.current.focus({ preventScroll: true });
            }
        });
        return () => window.cancelAnimationFrame(frame);
    }, [ focusKey, isOpen ]);

    const generate = async () => {
        setIsCreating(true);
        try {
            await createPairing();
        } catch (requestError) {
            // The shared hook gives the operator the server response.
        } finally {
            setIsCreating(false);
        }
    };

    const showRestart = Boolean(restartSetup && (pairingConsumed || (!currentPairing && modernDevice)));
    const readyText = deviceReady
        ? (selectedDevice?.name || 'This computer') + ' is ready for new work.'
        : currentPairing || selectedDevice
            ? 'Waiting for the worker to start and confirm readiness.'
            : 'Generate a setup command to connect a worker.';

    return <Modal
        show={ isOpen }
        onHide={ onHide }
        centered
        scrollable
        dialogClassName="delegation-setup-modal"
        contentClassName="delegation-setup-modal__content"
        aria-labelledby="delegation-setup-title"
    >
        <DialogHeader closeButton>
            <Modal.Title id="delegation-setup-title">Set up a standalone worker</Modal.Title>
        </DialogHeader>
        <Modal.Body>
            <div ref={ dialogBodyRef } className="delegation-setup-modal__body">
            <p className="delegation-setup-modal__intro">This alternate path runs a direct worker on a computer you control.</p>
            { error && <div className="delegation-panel__error delegation-setup-modal__error" role="alert">
                <i className="fe fe-alert-circle" aria-hidden="true" />
                <span>{ error }</span>
            </div> }

            <ol className="delegation-setup-steps">
                <li className="delegation-setup-step">
                    <span className="delegation-setup-step__number">1</span>
                    <div>
                        <h3>Choose an app</h3>
                        { showRestart ? <p>This computer is already connected with { providerName(restartDevice.provider) }. Its provider does not change when it restarts.</p> : <React.Fragment>
                            <p>Codex is the recommended standalone worker.</p>
                            <div className="delegation-provider-options" role="group" aria-label="Worker app">
                                <button type="button" className={ provider === 'codex' ? 'is-selected' : '' } onClick={ () => setProvider('codex') }>
                                    <strong>Codex</strong><small>Recommended</small>
                                </button>
                                <button type="button" className={ provider === 'claude' ? 'is-selected' : '' } onClick={ () => setProvider('claude') }>
                                    <strong>Claude</strong><small>Alternate</small>
                                </button>
                            </div>
                            <label className="delegation-provider-picker" htmlFor="delegation-pairing-name">
                                <span>Computer name</span>
                                <input id="delegation-pairing-name" value={ name } onChange={ event => setName(event.target.value) } maxLength={ 120 } />
                            </label>
                            { provider === 'codex' ? <div className="delegation-setup-help">
                            <p>Use Terminal on Mac, Linux, or WSL. Node 20+ and the Codex CLI signed in to ChatGPT are required.</p>
                            <details>
                                <summary>Need help?</summary>
                                <a href="https://learn.chatgpt.com/docs/codex/cli" target="_blank" rel="noreferrer">Install Codex CLI</a>
                                <a href="https://learn.chatgpt.com/docs/auth" target="_blank" rel="noreferrer">Check Codex sign-in</a>
                            </details>
                        </div> : <div className="delegation-setup-help">
                            <p>Use Terminal on Mac, Linux, or WSL. Node 20+ and Claude Code are required. The direct Claude worker also requires <code>ANTHROPIC_API_KEY</code> in that Terminal session; it uses API credentials.</p>
                        </div> }
                        </React.Fragment> }
                    </div>
                </li>

                <li className="delegation-setup-step">
                    <span className="delegation-setup-step__number">2</span>
                    <div>
                        <h3>Start worker</h3>
                        { showRestart ? <div className="delegation-setup-command">
                            <p>{ deviceReady
                                ? 'This worker is ready. Save this command for any later restart.'
                                : 'Open Terminal on the computer already connected as ' + (restartDevice.name || providerName(restartDevice.provider)) + ', paste this command, then leave it running.' }</p>
                            <DelegationCopyButton buttonRef={ setupActionRef } label="Copy start command" value={ restartSetup.startCommand } showLabel />
                            <details>
                                <summary>Show command</summary>
                                <pre>{ restartSetup.startCommand }</pre>
                            </details>
                            <button type="button" className="btn btn-link delegation-setup-command__alternate" onClick={ generate } disabled={ isCreating }>
                                Connect another computer
                            </button>
                            { modernDevice && <details className="delegation-setup-replace">
                                <summary>Replace the worker on this computer</summary>
                                <p>Stop the existing worker with <code>Ctrl+C</code>, disconnect its local pairing, then run the generated setup command. Queued work stays with the old device until you cancel it or revoke that device in Manage paired computers.</p>
                                <DelegationCopyButton label="Copy disconnect command" value={ restartSetup.disconnectCommand } showLabel />
                                <details>
                                    <summary>Show disconnect command</summary>
                                    <pre>{ restartSetup.disconnectCommand }</pre>
                                </details>
                                <button type="button" className="btn btn-link delegation-setup-command__alternate" onClick={ generate } disabled={ isCreating }>
                                    Generate replacement setup command
                                </button>
                            </details> }
                        </div> : currentPairing && setup && !pairingConsumed ? <div className="delegation-setup-command">
                            <p>Open Terminal on this computer, paste the block, press Enter, and leave it running.</p>
                            <DelegationCopyButton buttonRef={ setupActionRef } label="Copy setup command" value={ setup.setupCommand } showLabel />
                            <p className="delegation-setup-command__expiry">Pairing code expires in { formatRemaining(secondsLeft) }.</p>
                            <details>
                                <summary>Show command</summary>
                                <pre>{ setup.setupCommand }</pre>
                            </details>
                            <button type="button" className="btn btn-link delegation-setup-command__alternate" onClick={ generate } disabled={ isCreating }>
                                Generate a new code
                            </button>
                        </div> : <div className="delegation-setup-command">
                            <p>Generate a one-time setup command for this computer. It installs, pairs, and starts the worker.</p>
                            <button ref={ setupActionRef } type="button" className="btn btn-primary" onClick={ generate } disabled={ isCreating }>
                                { isCreating ? 'Generating…' : 'Generate setup command' }
                            </button>
                        </div> }
                    </div>
                </li>

                <li className="delegation-setup-step">
                    <span className="delegation-setup-step__number">3</span>
                    <div>
                        <h3>Ready</h3>
                        <p className={ 'delegation-worker-readiness' + (deviceReady ? ' is-ready' : '') }>
                            <i className={ deviceReady ? 'fe fe-check-circle' : 'fe fe-loader' } aria-hidden="true" />
                            { readyText }
                        </p>
                        { deviceReady
                            ? <button type="button" className="btn btn-primary delegation-setup-done" onClick={ onHide }>Continue to task</button>
                            : <button type="button" className="btn btn-link delegation-setup-command__alternate" onClick={ onRefresh }>Check again</button> }
                    </div>
                </li>
            </ol>

            { currentPairing && sessionSetup && !pairingConsumed && <details className="delegation-mcp-setup">
                <summary>Use an existing { providerName(provider) } desktop session instead</summary>
                <p>Set up the HappyToHelp MCP connection in the existing session. Its native browser and computer tools remain available.</p>
                <DelegationCopyButton label="Copy session setup" value={ sessionSetup.setupCommand } showLabel />
                <details>
                    <summary>Show session command</summary>
                    <pre>{ sessionSetup.setupCommand }</pre>
                </details>
                <p>Keep the session open and use this instruction:</p>
                <DelegationCopyButton label="Copy watch instruction" value={ sessionSetup.mcpWatchInstruction } showLabel />
            </details> }

            <details className="delegation-device-management">
                <summary>Manage paired computers</summary>
                <DelegationDevices devices={ devices } onRevoke={ onRevoke } />
            </details>
            </div>
        </Modal.Body>
    </Modal>;
}

DelegationPairing.propTypes = {
    createPairing: PropTypes.func.isRequired,
    devices: PropTypes.arrayOf(PropTypes.object).isRequired,
    error: PropTypes.string,
    isOpen: PropTypes.bool.isRequired,
    onHide: PropTypes.func.isRequired,
    onPairingExpired: PropTypes.func,
    onRefresh: PropTypes.func.isRequired,
    onRevoke: PropTypes.func.isRequired,
    onWorkerReady: PropTypes.func,
    pairing: PropTypes.shape({
        code: PropTypes.string,
        expires_at: PropTypes.string,
        id: PropTypes.string,
    }),
    projectId: PropTypes.string.isRequired,
};
