import React, { useEffect, useState } from 'react';
import { Field, Section } from './forms';
import { presenceSettings, PRESENCE_IDLE_MINUTES } from '../../../modules/management/availability';
import { backAt } from '../../../modules/widget/availability-text.js';
import { nativeRequest } from '../transport';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Who counts as online right now, read again with the clock: teammates who can reply, and the visitor assistant
// that keeps the team available when it answers.
function useOnline(projectId, now, saved) {
    const [online, setOnline] = useState({ data: null, error: '' });
    useEffect(() => {
        let active = true;
        nativeRequest(`/api/management/projects/${encodeURIComponent(projectId)}/presence`)
            .then(result => { if (active) setOnline({ data: result.data, error: '' }); })
            .catch(failure => { if (active) setOnline({ data: null, error: failure.message }); });
        return () => { active = false; };
    }, [projectId, now, saved]);
    return online;
}

// What visitors see with the saved settings, from the same server function as the widget.
function AvailabilityNow({ data, saved }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
    const online = useOnline(data.id, now, saved), people = online.data?.online || [], state = online.data?.availability;
    if (!state) return <p className="availability-now" role="status"><strong>Right now:</strong> {online.error ? `Visitor availability is unavailable: ${online.error}` : 'Checking visitor availability…'}</p>;
    const zone = state.timezone.replaceAll('_', ' ');
    const away = state.opensAt ? `Away. Back ${backAt(state.opensAt, { timeZone: state.timezone, now, withZone: true })}.` : state.live ? 'Away. No teammate who can reply is online.' : state.scheduled ? 'Away. Choose days and an opening time before the closing time.' : 'Away until you turn “Accept new conversations” back on.';
    const presence = !presenceSettings(data).enabled ? '' : online.error ? `Who is online is unavailable: ${online.error}` : !online.data ? '' : online.data.assistant ? state.available ? `${online.data.assistant.name} answers visitors, so the widget stays available when nobody is online.` : `${online.data.assistant.name} keeps answering visitors while your team is away.` : people.length ? `Online now: ${people.map(person => person.name || 'Teammate').join(', ')}.` : 'Nobody who can reply is online.';
    return <p className={`availability-now${state.available ? ' availability-now--open' : ' availability-now--away'}`} role="status">
        <strong>Right now:</strong> {state.available ? 'Available.' : away}{state.calendar ? <> SLA calendar “{state.calendar.name}” governs hours, holidays and closed dates in {zone}; manage it in Settings → Workflows.</> : state.scheduled && <> Hours are in {zone}; change the timezone on the General tab.</>}{presence && <> {presence}</>}
    </p>;
}

export default function AvailabilitySettings({ data, change, field, saved }) {
    const schedule = data.availability_schedule || {}, scheduleChange = (key, value) => change('availability_schedule', { ...schedule, [key]: value });
    const presence = presenceSettings(data);
    return <>
        <Section title="When your team is away" description="Outside your hours, with “Accept new conversations” off, or when no teammate who can reply is online, the chat widget says your team is away, shows the reopening time or your Human response time, and asks for the visitor’s email so your reply reaches them. Their conversation still reaches your inbox, and the away message is posted once in it. An AI assistant that answers visitors keeps answering.">
            <AvailabilityNow data={data} saved={saved} />
        </Section>
        <Section title="Schedule" description="A matching SLA calendar overrides these opening hours, including its holidays and closed dates. Manage calendars and policy order in Settings → Workflows. These hours apply when no SLA calendar matches.">
            {field('is_availability_schedule_enabled', 'Use opening hours', 'checkbox')}
            <label className="form-label">Days</label>
            <div className="project-days">{DAYS.map((day, i) => <label key={day}><input type="checkbox" checked={(schedule.days || []).includes(i + 1)} onChange={e => scheduleChange('days', e.target.checked ? [...(schedule.days || []), i + 1] : (schedule.days || []).filter(v => v !== i + 1))} />{day}</label>)}</div>
            <label className="form-label" htmlFor="schedule-from">Hours</label>
            <div className="project-hours"><input id="schedule-from" aria-label="Opening time" className="form-control" type="time" value={schedule.time_from || ''} onChange={e => scheduleChange('time_from', e.target.value)} /><span>to</span><input aria-label="Closing time" className="form-control" type="time" value={schedule.time_to || ''} onChange={e => scheduleChange('time_to', e.target.value)} /></div>
            <Field name="schedule-message" label="Away message outside hours" type="textarea" rows={3} value={schedule.message || ''} onChange={(_, value) => scheduleChange('message', value)} hint="Posted once in a conversation that starts outside your opening hours or during an SLA calendar closure. Leave it empty to say you are away, when you are back, and that you will reply by email." />
        </Section>
        <Section title="When nobody is online" description="While you are open, a teammate who can reply counts as online with HappyToHelp open and in use. When nobody is, visitors see the same away notice and email field as outside your hours. An AI assistant that answers visitors keeps the widget available.">
            <Field name="is_presence_away_enabled" label="Show away when no teammate is online" type="checkbox" value={presence.enabled} onChange={change} />
            <Field name="presence_idle_minutes" label="A teammate counts as away after" options={PRESENCE_IDLE_MINUTES.map(minutes => ({ value: minutes, label: `${minutes} minutes without using HappyToHelp` }))} value={presence.idleMinutes} onChange={(name, value) => change(name, Number(value))} hint="Closing HappyToHelp counts as away within seconds, a lost connection within 90 seconds. An open chat widget updates within 30 seconds." />
            <Field name="presence_away_message" label="Away message when nobody is online" type="textarea" rows={3} value={data.presence_away_message || ''} onChange={change} hint="Posted once in a conversation that starts while nobody is online. Leave it empty to say you are away and that you will reply by email." />
        </Section>
        <Section title="Close for a while">
            <Field name="is_available" label="Accept new conversations" type="checkbox" value={data.is_available !== false} onChange={change} hint="Turning this off overrides SLA calendars, opening hours and live presence. Visitors are told your team is away; conversations still arrive." />
            <Field name="unavailable_message" label="Away message while new conversations are off" type="textarea" rows={3} value={data.unavailable_message || ''} onChange={change} hint="Posted once in a conversation that starts while new conversations are off. Leave it empty for a standard message." />
        </Section>
    </>;
}
