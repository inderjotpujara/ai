/** In-run record of degradation events; surfaced to the user + telemetry. */
export enum DegradeKind {
  ModelDegraded = 'model_degraded',
  AgentDropped = 'agent_dropped',
  ToolSkipped = 'tool_skipped',
  Retried = 'retried',
  CircuitOpen = 'circuit_open',
}

export type DegradeEvent = {
  kind: DegradeKind;
  subject: string;
  reason: string;
  detail?: string;
  /** Structured counterparts to `detail`, populated by emit sites so
   *  telemetry can set typed span attributes without parsing the string. */
  from?: string;
  to?: string;
  attempts?: number;
  lane?: string;
};

export type DegradationLedger = {
  events: DegradeEvent[];
  record(e: DegradeEvent): void;
};

export function createLedger(): DegradationLedger {
  const events: DegradeEvent[] = [];
  return {
    events,
    record(e) {
      events.push(e);
    },
  };
}

const LABEL: Record<DegradeKind, string> = {
  [DegradeKind.ModelDegraded]: 'degraded model',
  [DegradeKind.AgentDropped]: 'dropped agent',
  [DegradeKind.ToolSkipped]: 'skipped tool',
  [DegradeKind.Retried]: 'retried',
  [DegradeKind.CircuitOpen]: 'circuit open',
};

/** Concise user-facing summary; empty string when nothing degraded. */
export function formatLedger(ledger: DegradationLedger): string {
  if (ledger.events.length === 0) return '';
  const lines = ledger.events.map((e) => {
    const tail = e.detail ? ` (${e.detail})` : '';
    return `  ⚠ ${LABEL[e.kind]}: ${e.subject} — ${e.reason}${tail}`;
  });
  return `Degraded during this run:\n${lines.join('\n')}`;
}

/** JSONL for persistence into run.dir. */
export function serializeLedger(ledger: DegradationLedger): string {
  return `${ledger.events.map((e) => JSON.stringify(e)).join('\n')}\n`;
}
