import React from 'react';
import PropTypes from 'prop-types';
import { Modal } from 'react-bootstrap';
import DelegationCopyButton from './DelegationCopyButton';
import DelegationDeviceSettings from './DelegationDeviceSettings';
import { isWorkerReady } from '../utils/localAgentSetup';
import { setupDocumentUrl, setupPrompt } from '../utils/localAgentSkillSetup';
import DialogHeader from './DialogHeader';

const serverOrigin = () => {
    if (typeof window === 'undefined') return '';
    return window.location.origin;
};

const isListening = device => Boolean(
    device
    && !device.revoked_at
    && device.connection_type === 'skill'
    && device.worker_mode === 'skill'
    && isWorkerReady(device)
);

export default function DelegationSkillSetup({ device, isOpen, onHide, onUseStandalone, projectId, projectName, onSettingsSaved }) {
    const listening = isListening(device);
    const origin = serverOrigin();
    const documentUrl = setupDocumentUrl(origin, projectId);
    const prompt = setupPrompt(origin, projectId);
    const needsAccountUpgrade = Boolean(device && device.connection_type === 'skill' && device.scope === 'workspace');

    return <Modal
        show={ isOpen }
        onHide={ onHide }
        centered
        scrollable
        dialogClassName="delegation-skill-modal"
        contentClassName="delegation-skill-modal__content"
        aria-labelledby="delegation-skill-setup-title"
    >
        <DialogHeader closeButton>
            <Modal.Title id="delegation-skill-setup-title">Connect HappyToHelp</Modal.Title>
        </DialogHeader>
        <Modal.Body>
            <div className="delegation-skill-modal__body">
                { device ? <section className={ 'delegation-skill-state' + (listening ? ' is-listening' : '') }>
                    <span className="delegation-skill-state__icon"><i className="fe fe-check-circle" aria-hidden="true" /></span>
                    <div>
                        <h3>{ listening ? 'Connected to your task' : 'Connection saved' }</h3>
                        <p>{ device.name || 'This Codex task' } is connected to { device.scope === 'account' ? 'your account' : 'this workspace only' } and can coordinate up to { device.max_concurrent_tasks || 1 } tasks at once.</p>
                    </div>
                </section> : <React.Fragment>
                    <section className="delegation-skill-state">
                        <span className="delegation-skill-state__icon"><i className="fe fe-zap" aria-hidden="true" /></span>
                        <div>
                            <h3>Connect your Codex task</h3>
                            <p>Codex sets up HappyToHelp if needed, then opens your browser to approve the account connection and waits for support assignments.</p>
                        </div>
                    </section>

                    <div className="delegation-skill-prompt">
                        <span>In the Codex task that will handle support work for { projectName || 'this workspace' }</span>
                        <DelegationCopyButton label="Copy HappyToHelp prompt" value={ prompt } showLabel />
                        <details>
                            <summary>Show prompt</summary>
                            <pre>{ prompt }</pre>
                        </details>
                    </div>

                    <details className="delegation-skill-first-use">
                        <summary>First time using HappyToHelp?</summary>
                        <p>Copy the prompt above. Codex opens the setup guide and prepares the skill in the same task.</p>
                        <a className="delegation-skill-download" href={ documentUrl } target="_blank" rel="noreferrer">
                            <i className="fe fe-external-link" aria-hidden="true" /> Open setup guide
                        </a>
                    </details>

                    <p className="delegation-skill-modal__note"><i className="fe fe-shield" aria-hidden="true" /> Approve your account in the browser. Assignments remain scoped to their conversation and workspace.</p>
                </React.Fragment> }

                { device && !listening && <details className="delegation-skill-first-use">
                    <summary>Resume this connection</summary>
                    <p>Open the connected Codex or Claude task and ask it to keep working on HappyToHelp assignments.</p>
                    <DelegationCopyButton label="Copy HappyToHelp prompt" value={ prompt } showLabel />
                </details> }

                { needsAccountUpgrade && <section className="delegation-skill-prompt">
                    <span>Connect this task across every workspace you can access</span>
                    <p>Copy this into the connected Codex task. It refreshes an older HappyToHelp skill from the guide’s manifest if needed, asks for fresh browser approval, then creates an account connection without changing the current workspace connection.</p>
                    <DelegationCopyButton label="Copy account upgrade prompt" value={ prompt } showLabel />
                    <a className="delegation-skill-download" href={ documentUrl } target="_blank" rel="noreferrer">
                        <i className="fe fe-external-link" aria-hidden="true" /> Open account setup guide
                    </a>
                </section> }

                { device && !device.revoked_at && <DelegationDeviceSettings
                    key={ device.id + ':' + projectId }
                    device={ device }
                    projectId={ projectId }
                    projectName={ projectName }
                    onSaved={ onSettingsSaved }
                /> }

                <details className="delegation-skill-alternate">
                    <summary>Use a standalone worker instead</summary>
                    <p>Set up a direct Codex or Claude worker on a computer you control. This is an alternate connection path.</p>
                    <button type="button" className="btn btn-link" onClick={ onUseStandalone }>
                        Set up standalone worker <i className="fe fe-arrow-right" aria-hidden="true" />
                    </button>
                </details>

                { device && <button type="button" className="btn btn-primary delegation-skill-done" onClick={ onHide }>
                    Continue to task
                </button> }
            </div>
        </Modal.Body>
    </Modal>;
}

DelegationSkillSetup.propTypes = {
    device: PropTypes.object,
    isOpen: PropTypes.bool.isRequired,
    onHide: PropTypes.func.isRequired,
    onUseStandalone: PropTypes.func.isRequired,
    projectId: PropTypes.string.isRequired,
    projectName: PropTypes.string,
    onSettingsSaved: PropTypes.func.isRequired,
};
