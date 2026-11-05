import { useCallback, useMemo, useRef, useState } from 'react';
import type { ApplyMindSweepResult, Language, MindSweepProposal, MindSweepProposalItem } from '@stride/core';
import { mobileAiCaptureApi, type AiCaptureApi } from './ai-capture-services';

export type AiCaptureStep = 'capture' | 'review' | 'done';
export type AiCaptureRow = MindSweepProposalItem & { included: boolean };

export function useAiCapture(language: Language = 'en', api: AiCaptureApi = mobileAiCaptureApi) {
  const [step, setStep] = useState<AiCaptureStep>('capture');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [proposal, setProposal] = useState<MindSweepProposal | null>(null);
  const [rows, setRows] = useState<AiCaptureRow[]>([]);
  const [applied, setApplied] = useState<ApplyMindSweepResult | null>(null);
  const [undone, setUndone] = useState(false);
  const runId = useRef(0);

  const organise = useCallback(async () => {
    const value = text.trim();
    if (!value || loading) return;
    const id = ++runId.current;
    setStep('review');
    setLoading(true);
    setProposal(null);
    let result: MindSweepProposal;
    try {
      result = await api.generate(value, language);
    } catch {
      result = { projects: [], items: [], summary: '', source: 'fallback', fallbackReason: 'failed' };
    }
    if (id !== runId.current) return;
    setProposal(result);
    setRows(result.items.map((item) => ({ ...item, included: true })));
    setLoading(false);
  }, [api, language, loading, text]);

  const updateRow = useCallback((key: string, patch: Partial<AiCaptureRow>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }, []);

  const included = useMemo(() => rows.filter((row) => row.included && row.title.trim().length > 0), [rows]);

  const add = useCallback(async (): Promise<ApplyMindSweepResult | null> => {
    if (!proposal || included.length === 0 || saving) return null;
    setSaving(true);
    try {
      const items = included.map(({ included: _included, ...item }) => ({ ...item, title: item.title.trim() }));
      const result = await api.apply({ projects: proposal.projects, items });
      setApplied(result);
      setStep('done');
      return result;
    } finally {
      setSaving(false);
    }
  }, [api, included, proposal, saving]);

  const undo = useCallback(async (batch: ApplyMindSweepResult | null = applied): Promise<boolean> => {
    if (!batch) return false;
    const ok = await api.undo(batch);
    if (ok) setUndone(true);
    return ok;
  }, [api, applied]);

  const backToCapture = useCallback(() => {
    runId.current += 1;
    setStep('capture');
    setLoading(false);
    setProposal(null);
    setRows([]);
  }, []);

  const reset = useCallback(() => {
    backToCapture();
    setText('');
    setApplied(null);
    setUndone(false);
  }, [backToCapture]);

  return { step, text, setText, loading, saving, proposal, rows, included, applied, undone, organise, updateRow, add, undo, backToCapture, reset };
}
