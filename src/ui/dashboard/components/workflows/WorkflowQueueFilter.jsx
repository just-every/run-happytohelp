import React from 'react';
import { Field } from '../../../native/pages/forms';

export const snoozedOptions = [{ value: '', label: 'Active' }, { value: 'only', label: 'Snoozed only' }, { value: 'include', label: 'Include snoozed' }];

/** Filters › Snoozed. "Snoozed only" with no view of its own is the rail's Snoozed place. */
export default function WorkflowQueueFilter({ value, onChange }) {
    return <Field name="workflow-queue-snoozed" label="Snoozed" value={['only', 'include'].includes(value) ? value : ''}
        options={snoozedOptions}
        onChange={(_, snoozed) => onChange(snoozed)}
        hint="Snoozed tickets stay out of active queues until their wake time or dependency completes. History searches can still find them."/>;
}
