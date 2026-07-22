import type { A2aSkillEntryWire } from '@contracts';
import { JobKindWire } from '@contracts';
import { useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';

const CARD_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4';
const CARD_TITLE_CLASS =
  'text-xs uppercase tracking-wide text-[var(--color-muted)]';
const INPUT_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-sm text-[var(--color-fg)]';
const FIELD_CLASS = 'flex flex-col gap-1 text-xs text-[var(--color-muted)]';

const JOB_KIND_OPTIONS = Object.values(JobKindWire);

function emptyRow(): A2aSkillEntryWire {
  return {
    skillId: '',
    name: '',
    description: '',
    kind: JobKindWire.Chat,
    ref: '',
  };
}

type Props = {
  skills: A2aSkillEntryWire[];
  /** Saves the whole desired skill set (`useA2aConfig().putSkills`, a
   *  `PUT /api/a2a/skills`). The server re-validates every `ref` against the
   *  in-process registries (§7.4 least-privilege) before persisting — an
   *  unknown ref 400s and nothing is stored; that rejection propagates
   *  through this promise so it surfaces in this editor's own error banner. */
  onSave: (skills: A2aSkillEntryWire[]) => Promise<void>;
};

/** Add/remove editor for the exposed-skill allowlist (Slice 31 Incr 7, T25).
 *  Each row is an `A2aSkillEntryWire`: `{skillId, name, description, kind,
 *  ref}`, `kind` a `JobKindWire` select. Edits are a local draft — nothing is
 *  persisted until "Save allowlist" — so `Add skill`/`Remove` never touch the
 *  server; only `onSave` does.
 *
 *  SECURITY: every operator-authored string (`name`, `description`, `ref`,
 *  `skillId`) renders via plain React interpolation ONLY — never
 *  `dangerouslySetInnerHTML` — including the read-only preview line per row,
 *  so a name shaped like `<img onerror>` renders as inert text
 *  (`federation-tab.test.tsx`). */
export function SkillAllowlistEditor({ skills, onSave }: Props) {
  const [rows, setRows] = useState<A2aSkillEntryWire[]>(skills);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  function updateRow(index: number, patch: Partial<A2aSkillEntryWire>) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setError(undefined);
    try {
      await onSave(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="a2a-skill-allowlist" className={CARD_CLASS}>
      <div className="flex items-center justify-between">
        <h2 className={CARD_TITLE_CLASS}>Exposed skills</h2>
        <Button data-testid="a2a-skill-add" onClick={addRow}>
          Add skill
        </Button>
      </div>

      {rows.length === 0 && (
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          No skills exposed yet.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="mt-2 flex flex-col gap-3">
          {rows.map((row, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable identity until saved (a fresh row's skillId starts empty).
              key={i}
              data-testid={`a2a-skill-row-${i}`}
              className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-2"
            >
              <div className="grid grid-cols-2 gap-2">
                <label className={FIELD_CLASS} htmlFor={`a2a-skill-id-${i}`}>
                  Skill ID
                  <input
                    id={`a2a-skill-id-${i}`}
                    data-testid={`a2a-skill-id-${i}`}
                    className={INPUT_CLASS}
                    value={row.skillId}
                    onChange={(e) => updateRow(i, { skillId: e.target.value })}
                  />
                </label>
                <label className={FIELD_CLASS} htmlFor={`a2a-skill-name-${i}`}>
                  Name
                  <input
                    id={`a2a-skill-name-${i}`}
                    data-testid={`a2a-skill-name-${i}`}
                    className={INPUT_CLASS}
                    value={row.name}
                    onChange={(e) => updateRow(i, { name: e.target.value })}
                  />
                </label>
                <label className={FIELD_CLASS} htmlFor={`a2a-skill-kind-${i}`}>
                  Kind
                  <select
                    id={`a2a-skill-kind-${i}`}
                    data-testid={`a2a-skill-kind-${i}`}
                    className={INPUT_CLASS}
                    value={row.kind}
                    onChange={(e) =>
                      updateRow(i, { kind: e.target.value as JobKindWire })
                    }
                  >
                    {JOB_KIND_OPTIONS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={FIELD_CLASS} htmlFor={`a2a-skill-ref-${i}`}>
                  Ref
                  <input
                    id={`a2a-skill-ref-${i}`}
                    data-testid={`a2a-skill-ref-${i}`}
                    className={INPUT_CLASS}
                    value={row.ref}
                    onChange={(e) => updateRow(i, { ref: e.target.value })}
                    placeholder="e.g. crew/support-triage"
                  />
                </label>
              </div>
              <label
                className={FIELD_CLASS}
                htmlFor={`a2a-skill-description-${i}`}
              >
                Description
                <input
                  id={`a2a-skill-description-${i}`}
                  data-testid={`a2a-skill-description-${i}`}
                  className={INPUT_CLASS}
                  value={row.description}
                  onChange={(e) =>
                    updateRow(i, { description: e.target.value })
                  }
                />
              </label>

              {/* Read-only preview of what this row will render as on the
               *  advertised card — plain interpolation, see file-level
               *  SECURITY note. */}
              <p
                data-testid={`a2a-skill-preview-${i}`}
                className="text-sm text-[var(--color-fg)]"
              >
                {row.name}
              </p>

              <Button
                data-testid={`a2a-skill-remove-${i}`}
                onClick={() => removeRow(i)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--color-muted)]">
          {error}
        </p>
      )}

      <Button
        data-testid="a2a-skill-save"
        variant="accent"
        className="mt-3"
        disabled={saving}
        onClick={() => void handleSave()}
      >
        {saving ? 'Saving…' : 'Save allowlist'}
      </Button>
    </div>
  );
}
