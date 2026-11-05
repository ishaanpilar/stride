import { useId, useMemo, useState } from 'react';
import { FileText, Loader2, Sparkles, X } from 'lucide-react';
import {
    mergeAreaContext,
    normalizeAreaDescription,
    normalizeAreaKeywords,
    tFallback,
    useTaskStore,
    type Area,
    type AreaDescribeResult,
    type Person,
} from '@stride/core';
import { Pill } from '../../ui/Pill';
import { isImeComposing } from '../../../lib/ime';
import { describeArea } from '../../../lib/area-describe-service';

type Translate = (key: string) => string;

/** Row button that opens an area's routing context; a small dot marks areas that have some. */
export function AreaContextToggle({ area, open, onToggle, label, controls }: {
    area: Area;
    open: boolean;
    onToggle: () => void;
    label: string;
    controls?: string;
}) {
    const hasContext = Boolean(area.description || area.keywords?.length || area.peopleIds?.length);
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={controls}
            aria-label={label}
            title={label}
            className={`relative h-8 w-8 shrink-0 rounded-control flex items-center justify-center transition-colors focus-ring ${open ? 'bg-accent-soft text-accent-text' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
        >
            <FileText className="h-4 w-4" aria-hidden />
            {hasContext && <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />}
        </button>
    );
}

export type AreaContextEditorProps = {
    area: Area;
    t: Translate;
    /** Test seam; defaults to the AI-backed service (which falls back to the plain paragraph). */
    describe?: (areaName: string, text: string) => Promise<AreaDescribeResult>;
};

const fill = (template: string, values: Record<string, string>) =>
    Object.entries(values).reduce((out, [key, value]) => out.split(`{{${key}}}`).join(value), template);

const inputClass = 'w-full bg-well shadow-soft-inset rounded-control px-2 py-1.5 text-sm placeholder:text-tertiary focus-ring';
const chipRemove = 'inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-accent focus-ring';

/**
 * Routing context for one area: a description, keyword chips and linked People, plus a small
 * "Describe with AI" helper. Everything is optional and saved straight to the synced Area.
 */
export function AreaContextEditor({ area, t: rawT, describe = describeArea }: AreaContextEditorProps) {
    const t = (key: string, fallback: string) => tFallback(rawT, key, fallback);
    const ids = { description: useId(), keywords: useId(), people: useId(), describe: useId(), list: useId() };
    const updateArea = useTaskStore((s) => s.updateArea);
    const addPerson = useTaskStore((s) => s.addPerson);
    const people = useTaskStore((s) => s.people);
    const livePeople = useMemo(() => people.filter((p) => !p.deletedAt), [people]);
    const linked = useMemo(() => (area.peopleIds ?? [])
        .map((id) => livePeople.find((p) => p.id === id))
        .filter((p): p is Person => Boolean(p)), [area.peopleIds, livePeople]);

    const [keywordDraft, setKeywordDraft] = useState('');
    const [personDraft, setPersonDraft] = useState('');
    const [describeOpen, setDescribeOpen] = useState(false);
    const [describeText, setDescribeText] = useState('');
    const [busy, setBusy] = useState(false);
    const [suggestion, setSuggestion] = useState<AreaDescribeResult | null>(null);
    const [suggestedDescription, setSuggestedDescription] = useState('');

    const commitDescription = (raw: string) => {
        const next = normalizeAreaDescription(raw);
        if ((next ?? '') === (area.description ?? '')) return;
        void updateArea(area.id, { description: next });
    };
    const setKeywords = (next: string[]) => void updateArea(area.id, { keywords: normalizeAreaKeywords(next) });
    const addKeyword = () => {
        const parts = keywordDraft.split(',').map((k) => k.trim()).filter(Boolean);
        if (!parts.length) return;
        setKeywords([...(area.keywords ?? []), ...parts]);
        setKeywordDraft('');
    };
    const setPeople = (nextIds: string[]) => void updateArea(area.id, { peopleIds: nextIds.length ? nextIds : undefined });

    const findPerson = (name: string) => livePeople.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
    const linkPerson = async () => {
        const name = personDraft.trim();
        if (!name) return;
        const person = findPerson(name) ?? await addPerson(name);
        if (person && !(area.peopleIds ?? []).includes(person.id)) setPeople([...(area.peopleIds ?? []), person.id]);
        setPersonDraft('');
    };

    const runDescribe = async () => {
        const text = describeText.trim();
        if (!text || busy) return;
        setBusy(true);
        try {
            const result = await describe(area.name, text);
            setSuggestion(result);
            setSuggestedDescription(result.description ?? '');
        } finally {
            setBusy(false);
        }
    };

    const saveSuggestion = async () => {
        if (!suggestion) return;
        const peopleIds: string[] = [];
        for (const name of suggestion.people ?? []) {
            const person = findPerson(name) ?? await addPerson(name);
            if (person) peopleIds.push(person.id);
        }
        const merged = mergeAreaContext(area, { description: suggestedDescription, keywords: suggestion.keywords, peopleIds });
        await updateArea(area.id, merged);
        setSuggestion(null);
        setDescribeText('');
        setDescribeOpen(false);
    };

    const personDraftIsNew = personDraft.trim() && !findPerson(personDraft);

    return (
        <div className="space-y-3 rounded-card bg-well p-3 shadow-soft-inset" data-testid="area-context-editor">
            <p className="text-xs text-muted-foreground">{t('areaContext.aiHint', 'The AI uses this to put tasks in the right area.')}</p>
            <div className="space-y-1">
                <label htmlFor={ids.description} className="text-[13px] font-medium text-muted-foreground">{t('areaContext.description', 'Description')}</label>
                <textarea
                    id={ids.description}
                    key={`${area.id}-${area.updatedAt}`}
                    defaultValue={area.description ?? ''}
                    onBlur={(e) => commitDescription(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder={t('areaContext.descriptionPlaceholder', 'What belongs here: clients, people, products, keywords')}
                    className={`${inputClass} resize-y bg-card`}
                />
            </div>

            <div className="space-y-1">
                <label htmlFor={ids.keywords} className="text-[13px] font-medium text-muted-foreground">{t('areaContext.keywords', 'Keywords')}</label>
                <div className="flex flex-wrap items-center gap-1.5">
                    {(area.keywords ?? []).map((keyword) => (
                        <Pill key={keyword} className="bg-card">
                            {keyword}
                            <button
                                type="button"
                                className={chipRemove}
                                aria-label={fill(t('areaContext.removeKeyword', 'Remove keyword {{name}}'), { name: keyword })}
                                onClick={() => setKeywords((area.keywords ?? []).filter((k) => k !== keyword))}
                            >
                                <X className="h-3 w-3" aria-hidden />
                            </button>
                        </Pill>
                    ))}
                    <input
                        id={ids.keywords}
                        value={keywordDraft}
                        onChange={(e) => setKeywordDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (isImeComposing(e)) return;
                            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addKeyword(); }
                        }}
                        onBlur={addKeyword}
                        placeholder={t('areaContext.keywordsPlaceholder', 'Add a keyword and press Enter')}
                        className={`${inputClass} min-w-[10rem] flex-1 bg-card`}
                    />
                </div>
            </div>

            <div className="space-y-1">
                <label htmlFor={ids.people} className="text-[13px] font-medium text-muted-foreground">{t('areaContext.people', 'People')}</label>
                <div className="flex flex-wrap items-center gap-1.5">
                    {linked.map((person) => (
                        <Pill key={person.id} className="bg-card">
                            {person.name}
                            <button
                                type="button"
                                className={chipRemove}
                                aria-label={fill(t('areaContext.removePerson', 'Remove {{name}}'), { name: person.name })}
                                onClick={() => setPeople((area.peopleIds ?? []).filter((id) => id !== person.id))}
                            >
                                <X className="h-3 w-3" aria-hidden />
                            </button>
                        </Pill>
                    ))}
                    <input
                        id={ids.people}
                        list={ids.list}
                        value={personDraft}
                        onChange={(e) => setPersonDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (isImeComposing(e)) return;
                            if (e.key === 'Enter') { e.preventDefault(); void linkPerson(); }
                        }}
                        placeholder={t('areaContext.peoplePlaceholder', 'Add a person')}
                        aria-describedby={personDraftIsNew ? `${ids.people}-new` : undefined}
                        className={`${inputClass} min-w-[10rem] flex-1 bg-card`}
                    />
                    <datalist id={ids.list}>
                        {livePeople.filter((p) => !(area.peopleIds ?? []).includes(p.id)).map((p) => <option key={p.id} value={p.name} />)}
                    </datalist>
                </div>
                {personDraftIsNew && (
                    <p id={`${ids.people}-new`} className="text-xs text-muted-foreground">
                        {fill(t('areaContext.newPerson', 'New person: {{name}}'), { name: personDraft.trim() })}
                    </p>
                )}
            </div>

            <div className="space-y-2">
                {!describeOpen ? (
                    <button
                        type="button"
                        onClick={() => setDescribeOpen(true)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-control bg-card px-2.5 text-[13px] font-medium shadow-soft-sm hover:bg-accent focus-ring"
                    >
                        <Sparkles className="h-3.5 w-3.5" aria-hidden />
                        {t('areaContext.describeWithAi', 'Describe with AI')}
                    </button>
                ) : (
                    <div className="space-y-2">
                        <label htmlFor={ids.describe} className="text-[13px] font-medium text-muted-foreground">{t('areaContext.describeWithAi', 'Describe with AI')}</label>
                        <textarea
                            id={ids.describe}
                            value={describeText}
                            onChange={(e) => setDescribeText(e.target.value)}
                            rows={3}
                            placeholder={t('areaContext.describePlaceholder', 'Tell the AI about this area: what it does, your role, products, people…')}
                            className={`${inputClass} resize-y bg-card`}
                        />
                        {!suggestion && (
                            <div className="flex gap-2">
                                <button type="button" onClick={() => void runDescribe()} disabled={!describeText.trim() || busy} className="btn-gradient h-8 rounded-control px-3 text-[13px] font-semibold focus-ring disabled:opacity-50">
                                    {busy ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />{t('areaContext.generating', 'Thinking…')}</span> : t('areaContext.generate', 'Suggest')}
                                </button>
                                <button type="button" onClick={() => { setDescribeOpen(false); setDescribeText(''); }} className="h-8 rounded-control bg-card px-3 text-[13px] shadow-soft-sm hover:bg-accent focus-ring">
                                    {t('common.cancel', 'Cancel')}
                                </button>
                            </div>
                        )}
                        {suggestion && (
                            <div className="space-y-2 rounded-control bg-card p-2.5 shadow-soft-sm" data-testid="area-context-suggestion" role="region" aria-label={t('areaContext.review', 'Review the suggestion, then save')}>
                                <p className="text-xs font-medium text-muted-foreground">{t('areaContext.review', 'Review the suggestion, then save')}</p>
                                {suggestion.source === 'fallback' && (
                                    <p className="text-xs text-muted-foreground" role="status">{t('areaContext.fallbackNotice', 'AI is unavailable, so your text was kept as the description.')}</p>
                                )}
                                <textarea
                                    value={suggestedDescription}
                                    onChange={(e) => setSuggestedDescription(e.target.value)}
                                    rows={3}
                                    aria-label={t('areaContext.description', 'Description')}
                                    className={`${inputClass} resize-y`}
                                />
                                {(suggestion.keywords?.length ?? 0) > 0 && (
                                    <div className="flex flex-wrap gap-1.5" aria-label={t('areaContext.keywords', 'Keywords')}>
                                        {suggestion.keywords!.map((k) => <Pill key={k}>{k}</Pill>)}
                                    </div>
                                )}
                                {(suggestion.people?.length ?? 0) > 0 && (
                                    <div className="flex flex-wrap gap-1.5" aria-label={t('areaContext.people', 'People')}>
                                        {suggestion.people!.map((name) => (
                                            <Pill key={name} tone={findPerson(name) ? 'neutral' : 'accent'} title={findPerson(name) ? undefined : t('areaContext.willCreate', 'will be added to People')}>
                                                {name}
                                                {!findPerson(name) && (
                                                    <>
                                                        <span aria-hidden>+</span>
                                                        <span className="sr-only">{` (${t('areaContext.willCreate', 'will be added to People')})`}</span>
                                                    </>
                                                )}
                                            </Pill>
                                        ))}
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => void saveSuggestion()} className="btn-gradient h-8 rounded-control px-3 text-[13px] font-semibold focus-ring">
                                        {t('areaContext.save', 'Save to area')}
                                    </button>
                                    <button type="button" onClick={() => setSuggestion(null)} className="h-8 rounded-control bg-card px-3 text-[13px] shadow-soft-sm hover:bg-accent focus-ring">
                                        {t('common.cancel', 'Cancel')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
