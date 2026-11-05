import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AssistantReadiness, AssistantSession } from '@stride/core';
import { useTaskStore } from '@stride/core';
import { getMobileAssistantReadiness, getMobileAssistantSession } from './assistant-services';

export type AssistantControls = {
  session: AssistantSession;
  warm?: () => Promise<void>;
  getReadiness?: () => Promise<AssistantReadiness>;
};

export function useAssistant(controls?: AssistantControls) {
  const [resolved] = useState(() => controls ?? { ...getMobileAssistantSession(), getReadiness: getMobileAssistantReadiness });
  const { session, warm, getReadiness = getMobileAssistantReadiness } = resolved;
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [readiness, setReadiness] = useState<AssistantReadiness | null>(null);
  const aiSettings = useTaskStore((s) => s.settings?.ai);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await warm?.();
      if (alive) session.hydrate();
    })();
    return () => { alive = false; };
  }, [session, warm]);

  useEffect(() => {
    let alive = true;
    void getReadiness().then((r) => { if (alive) setReadiness(r); }).catch(() => { if (alive) setReadiness({ ready: false, reason: 'disabled' }); });
    return () => { alive = false; };
  }, [aiSettings, getReadiness]);

  return { session, state, readiness };
}
