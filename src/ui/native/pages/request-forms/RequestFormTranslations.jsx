import React, { useState } from 'react';
import { Field } from '../forms';

const languages = [['fr', 'French'], ['es', 'Spanish'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ja', 'Japanese'], ['zh', 'Chinese'], ['en', 'English']];
const builtins = [{ id: 'subject', name: 'Subject', options: [] }, { id: 'message', name: 'Message', options: [] }];
const withText = (object, key, value) => { const next = { ...object }; if (typeof value !== 'string' || value.trim()) next[key] = value; else delete next[key]; return next; };

export default function RequestFormTranslations({ draft, definitions, onChange }) {
    const [selected, setSelected] = useState(''), [newLocale, setNewLocale] = useState('fr'), [error, setError] = useState('');
    const locale = selected || draft.locale, translation = draft.translations[locale] || {};
    const locales = [...new Set([draft.locale, ...Object.keys(draft.translations)])];
    const fields = [...builtins, ...draft.fields.map(field => definitions.find(item => item.id === field.fieldId)).filter(Boolean)];
    const update = value => onChange({ ...draft.translations, [locale]: value });
    const updateField = (fieldId, key, value) => update({ ...translation, fields: { ...translation.fields, [fieldId]: withText(translation.fields?.[fieldId], key, value) } });
    const addLocale = () => {
        const value = newLocale.trim();
        try { if (!value || value.length > 35) throw new Error(); Intl.getCanonicalLocales(value); }
        catch { setError('Enter a valid language code, such as fr or fr-CA.'); return; }
        if (!locales.includes(value) && Object.keys(draft.translations).length >= 30) { setError('A form can have up to 30 translations.'); return; }
        setError('');
        if (!locales.includes(value)) onChange({ ...draft.translations, [value]: {} });
        setSelected(value === draft.locale ? '' : value);
    };
    return <section className="request-form-translations" aria-labelledby="request-form-translations-title">
        <h3 id="request-form-translations-title">Customer wording & translations</h3>
        <p className="settings-note">Customize field labels and help text in the default language, then add translations. Empty translations use the default wording. Option values stay the same when their labels are translated.</p>
        <div className="request-form-language-controls"><Field name="request-form-language" label="Editing language" value={locale} options={locales.map(value => ({ value, label: `${languages.find(([code]) => code === value)?.[1] || value}${value === draft.locale ? ' (default)' : ` · ${value}`}` }))} onChange={(_, value) => setSelected(value === draft.locale ? '' : value)}/>
            <div className="request-form-add-language"><Field name="request-form-new-language" label="Add language code" value={newLocale} placeholder="fr" hint="For example fr for French or fr-CA for Canadian French." error={error} onChange={(_, value) => { setNewLocale(value); setError(''); }}/><button type="button" className="btn btn-outline-secondary" onClick={addLocale}>Add language</button></div>
        </div>
        {locale !== draft.locale && <div className="request-form-translation-copy">
            <Field name={`request-${locale}-title`} label="Translated form name" value={translation.title} placeholder={draft.title} onChange={(_, value) => update(withText(translation, 'title', value))}/>
            <Field name={`request-${locale}-description`} label="Translated description" type="textarea" rows={3} value={translation.description} placeholder={draft.description} onChange={(_, value) => update(withText(translation, 'description', value))}/>
            <Field name={`request-${locale}-submit`} label="Translated submit button" value={translation.submitLabel} placeholder={draft.submitLabel} onChange={(_, value) => update(withText(translation, 'submitLabel', value))}/>
            <button type="button" className="btn btn-link" onClick={() => { const next = { ...draft.translations }; delete next[locale]; onChange(next); setSelected(''); }}>Remove {locale} translation</button>
        </div>}
        <div className="request-form-wording-list">{fields.map(field => {
            const copy = translation.fields?.[field.id] || {}, base = draft.translations[draft.locale]?.fields?.[field.id] || {};
            return <fieldset key={field.id} className="request-form-wording"><legend>{field.name}</legend>
                <Field name={`request-${locale}-${field.id}-label`} label={`${field.name} label`} value={copy.label} placeholder={base.label || field.name} onChange={(_, value) => updateField(field.id, 'label', value)}/>
                <Field name={`request-${locale}-${field.id}-help`} label={`${field.name} help text`} type="textarea" rows={2} value={copy.description} placeholder={base.description} onChange={(_, value) => updateField(field.id, 'description', value)}/>
                {field.options?.map((option, index) => <Field key={option} name={`request-${locale}-${field.id}-option-${index}`} label={`${field.name} option: ${option}`} value={copy.options?.[option]} placeholder={base.options?.[option] || option} onChange={(_, value) => updateField(field.id, 'options', withText(copy.options, option, value))}/>)}
            </fieldset>;
        })}</div>
    </section>;
}
