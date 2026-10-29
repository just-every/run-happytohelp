import { useUnsavedChanges } from '../NavigationGuard';
import React, { useState,useEffect } from 'react';
import { Field, Section } from './forms';
import { RUN_KINDS, TRAINING_LIMITS, validateTrainingRun } from './training-run-form';

const initial = {kind: 'evaluation', models: '', cases: '', variants: '', max_cost: '', max_tokens: ''};
const order = ['kind', 'models', 'cases', 'variants', 'max_cost', 'max_tokens'];
/** Form to start an evaluation or simulation. Problems are shown beside the field and nothing is sent until the input is valid. */
export default function TrainingRunForm({ onCreate, disabled = false, procedure = null, onClearProcedure }) {
    const {markDirty,markSaved}=useUnsavedChanges();
    const [draft, setDraft] = useState(initial), [errors, setErrors] = useState({}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useEffect(()=>{if(procedure)setDraft(current=>({...current,models:procedure.model,max_cost:procedure.config.maxCost,max_tokens:procedure.config.maxTokens,variants:'["prototype"]'}));},[procedure]);
    const change = (name, value) => { markDirty(); setDraft(current => ({...current, [name]: value})); setErrors(({[name]: _, ...rest}) => rest); };
    const submit = async event => {
        event.preventDefault();
        if (disabled || busy) return;
        setError('');
        const result = validateTrainingRun(draft);
        if (result.errors) {
            setErrors(result.errors);
            const first = order.find(name => result.errors[name]);
            requestAnimationFrame(() => document.getElementById(first)?.focus());
            return;
        }
        setBusy(true);
        try {
            await onCreate({...result.value,...(procedure?{procedureVersionId:procedure.id}:{})}, () => {
                setDraft(initial); setErrors({}); markSaved();
            });
        } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const field = (name, label, props = {}) => <Field {...{name, label}} error={errors[name]} value={draft[name]} onChange={change} {...props}/>;
    return <form className="training-run-form" aria-label="Start evaluation run" onSubmit={submit} noValidate><Section title="Start a run" description="Choose the models and cases to run, and the most this run may spend.">
        {procedure&&<p role="status">Evaluating {procedure.procedure_key} version {procedure.version}. <button type="button" className="btn btn-link" onClick={onClearProcedure}>Use an unbound evaluation</button></p>}
        {field('kind', 'Run type', {options: RUN_KINDS})}
        {field('models', 'Models (one per line)', {type: 'textarea', rows: 3, required: true, hint: 'Every case runs on each model listed.'})}
        {field('cases', 'Case definitions (JSON)', {type: 'textarea', required: true, placeholder: '[{"id": "refund-status"}]', hint: `A list of cases, each with a unique text id. Up to ${TRAINING_LIMITS.maxCases.toLocaleString('en-US')} cases per run.`})}
        {field('variants', 'Variants (JSON)', {type: 'textarea', rows: 2, placeholder: '["prototype", "baseline"]', hint: 'Optional. Choose from "prototype", "baseline" and "legacy-ui". Leave empty to run the prototype only.'})}
        <div className="settings-grid">
            {field('max_cost', 'Maximum cost', {type: 'number', required: true, min: 0, step: 'any', hint: 'The most this whole run may spend, in US dollars. It must be greater than 0. Each case reserves its share before it starts, and a budget too small for a model’s worst case is refused before any provider call.'})}
            {field('max_tokens', 'Maximum tokens', {type: 'number', required: true, min: 1, max: TRAINING_LIMITS.maxTokens, step: 1, hint: `The longest reply each model may write, from 1 to ${TRAINING_LIMITS.maxTokens.toLocaleString('en-US')} tokens.`})}
        </div>
        {error && <div role="alert" className="alert alert-danger">{error}</div>}
    </Section><button className="btn btn-primary" disabled={disabled || busy}>{busy ? 'Creating…' : 'Create run'}</button></form>;
}
