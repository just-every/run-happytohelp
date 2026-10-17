import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import useLiveInboxLocation from '../../hooks/useLiveInboxLocation';
import { Field } from '../../../native/pages/forms';
export default function WorkflowQueueFilter() {
    const { search } = useLiveInboxLocation(), navigate = useNavigate();
    const value = ['only', 'include'].includes(search.snoozed) ? search.snoozed : '';
    return <Field name="workflow-queue-snoozed" label="Snoozed tickets" value={value}
        options={[{ value: '', label: 'Active tickets' }, { value: 'only', label: 'Snoozed tickets' }, { value: 'include', label: 'Include snoozed' }]}
        onChange={(_, snoozed) => navigate({ search: { ...search, snoozed: snoozed || undefined } })}
        hint="Snoozed tickets stay out of active queues until their wake time or dependency completes. History searches can still find them."/>;
}
