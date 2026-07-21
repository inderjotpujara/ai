import type { TriggerCreateRequest, TriggerCreateResponse } from '@contracts';
import { JobKindWire, TriggerTypeWire } from '@contracts';
import { useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import { Dialog } from '../../shared/ui/dialog.tsx';
import { useTriggers } from './use-triggers.ts';

const INPUT_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-sm text-[var(--color-fg)]';
const FIELD_CLASS = 'flex flex-col gap-1 text-sm text-[var(--color-fg)]';
const CHECKBOX_LABEL_CLASS =
  'flex items-center gap-2 text-sm text-[var(--color-fg)]';

const TRIGGER_TYPE_OPTIONS = Object.values(TriggerTypeWire);
const JOB_KIND_OPTIONS = Object.values(JobKindWire);

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lets the caller (TriggersTab, holding its own `useTriggers()`) refresh
   *  ITS list after a successful create. This dialog performs the create
   *  through its own `useTriggers()` instance (a separate hook instance, its
   *  own `triggers`/`error` state) so it stays mountable standalone — the
   *  `PairDeviceDialog`/`onPaired` precedent (Slice 25b, T38). */
  onCreated?: () => void;
};

/** "New trigger" dialog (Slice 25, Task 29). Authors a console-origin
 *  trigger via `useTriggers().create` — per-`type` config forms (T1's
 *  non-discriminated-union carry: `type` selects among four otherwise
 *  unrelated config shapes, `CronConfigSchema`/`WebhookConfigSchema`/
 *  `FileConfigSchema`/`JobChainConfigSchema` in `requests.ts`) plus the
 *  common target (job kind + JSON payload) and name.
 *
 *  WEBHOOK TOKEN SHOWN ONCE (mirrors `PairDeviceDialog`'s once-shown
 *  `token`/`pairingUrl`, Slice 25b T38): a webhook create's response carries
 *  `webhookToken`/`webhookUrl` — server-minted, present in THIS response
 *  ONLY (`TriggerCreateResponseSchema` note, `requests.ts`). They render in a
 *  post-create confirmation panel with a "won't be shown again" warning and
 *  copy affordances; closing/reopening the dialog resets `result` to
 *  `undefined` so nothing lingers client-side. The webhook `hmac` checkbox
 *  is the ONLY webhook input — the secret/token themselves are never
 *  entered, only server-minted.
 *
 *  SECURITY: the only user-authored free text echoed back (`result.trigger
 *  .name`) renders via plain React interpolation ONLY — never
 *  `dangerouslySetInnerHTML` — the T28/25b XSS-escape precedent. */
export function TriggerCreateDialog({ open, onOpenChange, onCreated }: Props) {
  const { create } = useTriggers();

  const [name, setName] = useState('');
  const [type, setType] = useState<TriggerTypeWire>(TriggerTypeWire.Cron);
  const [targetKind, setTargetKind] = useState<JobKindWire>(JobKindWire.Chat);
  const [payloadText, setPayloadText] = useState('{}');

  // Cron config
  const [schedule, setSchedule] = useState('');
  const [timezone, setTimezone] = useState('');
  const [catchUp, setCatchUp] = useState(false);
  const [allowOverlap, setAllowOverlap] = useState(false);

  // Webhook config — hmac is the ONLY input; token/secret are server-minted.
  const [hmac, setHmac] = useState(false);

  // File config
  const [path, setPath] = useState('');
  const [eventAdd, setEventAdd] = useState(true);
  const [eventChange, setEventChange] = useState(true);

  // JobChain config
  const [onKind, setOnKind] = useState('');
  const [onName, setOnName] = useState('');
  const [onStatus, setOnStatus] = useState<'done' | 'failed'>('done');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<TriggerCreateResponse | undefined>(
    undefined,
  );

  function reset() {
    setName('');
    setType(TriggerTypeWire.Cron);
    setTargetKind(JobKindWire.Chat);
    setPayloadText('{}');
    setSchedule('');
    setTimezone('');
    setCatchUp(false);
    setAllowOverlap(false);
    setHmac(false);
    setPath('');
    setEventAdd(true);
    setEventChange(true);
    setOnKind('');
    setOnName('');
    setOnStatus('done');
    setSubmitting(false);
    setError(undefined);
    setResult(undefined);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  /** Per-`type` config, matching `CronConfigSchema`/`WebhookConfigSchema`/
   *  `FileConfigSchema`/`JobChainConfigSchema` (`requests.ts`) — the server
   *  re-validates against the schema matching `type` (Task 23), so shape
   *  drift here just surfaces as a 400, never silently accepted. */
  function buildConfig(): unknown {
    switch (type) {
      case TriggerTypeWire.Cron:
        return {
          schedule,
          ...(timezone.trim() ? { timezone: timezone.trim() } : {}),
          catchUp,
          allowOverlap,
        };
      case TriggerTypeWire.Webhook:
        return { hmac };
      case TriggerTypeWire.File:
        return {
          path,
          events: [
            ...(eventAdd ? (['add'] as const) : []),
            ...(eventChange ? (['change'] as const) : []),
          ],
        };
      case TriggerTypeWire.JobChain:
        return {
          ...(onKind ? { onKind: onKind as JobKindWire } : {}),
          ...(onName.trim() ? { onName: onName.trim() } : {}),
          onStatus,
        };
      default:
        return {};
    }
  }

  async function handleSubmit() {
    if (!name.trim() || submitting) return;

    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      setError('target payload must be valid JSON');
      return;
    }

    setSubmitting(true);
    setError(undefined);
    try {
      const body: TriggerCreateRequest = {
        name: name.trim(),
        type,
        target: { kind: targetKind, payload },
        config: buildConfig(),
      };
      const res = await create(body);
      setResult(res);
      onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed');
    } finally {
      setSubmitting(false);
    }
  }

  function copy(value: string) {
    navigator.clipboard?.writeText(value);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} title="New trigger">
      {!result && (
        <div className="flex flex-col gap-3">
          <label className={FIELD_CLASS} htmlFor="trigger-name">
            Name
            <input
              id="trigger-name"
              data-testid="trigger-name"
              className={INPUT_CLASS}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. nightly-build"
            />
          </label>

          <label className={FIELD_CLASS} htmlFor="trigger-type">
            Type
            <select
              id="trigger-type"
              data-testid="trigger-type"
              className={INPUT_CLASS}
              value={type}
              onChange={(e) => setType(e.target.value as TriggerTypeWire)}
            >
              {TRIGGER_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          {type === TriggerTypeWire.Cron && (
            <div
              className="flex flex-col gap-3"
              data-testid="trigger-config-cron"
            >
              <label className={FIELD_CLASS} htmlFor="trigger-cron-schedule">
                Cron schedule
                <input
                  id="trigger-cron-schedule"
                  data-testid="trigger-cron-schedule"
                  className={INPUT_CLASS}
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  placeholder="0 2 * * *"
                />
              </label>
              <label className={FIELD_CLASS} htmlFor="trigger-cron-timezone">
                Timezone (optional)
                <input
                  id="trigger-cron-timezone"
                  data-testid="trigger-cron-timezone"
                  className={INPUT_CLASS}
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="America/Los_Angeles"
                />
              </label>
              <label
                className={CHECKBOX_LABEL_CLASS}
                htmlFor="trigger-cron-catchup"
              >
                <input
                  id="trigger-cron-catchup"
                  data-testid="trigger-cron-catchup"
                  type="checkbox"
                  checked={catchUp}
                  onChange={(e) => setCatchUp(e.target.checked)}
                />
                Catch up missed runs
              </label>
              <label
                className={CHECKBOX_LABEL_CLASS}
                htmlFor="trigger-cron-allow-overlap"
              >
                <input
                  id="trigger-cron-allow-overlap"
                  data-testid="trigger-cron-allow-overlap"
                  type="checkbox"
                  checked={allowOverlap}
                  onChange={(e) => setAllowOverlap(e.target.checked)}
                />
                Allow overlapping runs
              </label>
            </div>
          )}

          {type === TriggerTypeWire.Webhook && (
            <div
              className="flex flex-col gap-2"
              data-testid="trigger-config-webhook"
            >
              <label
                className={CHECKBOX_LABEL_CLASS}
                htmlFor="trigger-webhook-hmac"
              >
                <input
                  id="trigger-webhook-hmac"
                  data-testid="trigger-webhook-hmac"
                  type="checkbox"
                  checked={hmac}
                  onChange={(e) => setHmac(e.target.checked)}
                />
                Require HMAC signature
              </label>
              <p className="text-xs text-[var(--color-muted)]">
                The webhook token — and the HMAC secret, if enabled — are minted
                by the server on create. There is nothing to enter here.
              </p>
            </div>
          )}

          {type === TriggerTypeWire.File && (
            <div
              className="flex flex-col gap-3"
              data-testid="trigger-config-file"
            >
              <label className={FIELD_CLASS} htmlFor="trigger-file-path">
                Watch path
                <input
                  id="trigger-file-path"
                  data-testid="trigger-file-path"
                  className={INPUT_CLASS}
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="./watched-dir"
                />
              </label>
              <div className="flex gap-4">
                <label
                  className={CHECKBOX_LABEL_CLASS}
                  htmlFor="trigger-file-event-add"
                >
                  <input
                    id="trigger-file-event-add"
                    data-testid="trigger-file-event-add"
                    type="checkbox"
                    checked={eventAdd}
                    onChange={(e) => setEventAdd(e.target.checked)}
                  />
                  add
                </label>
                <label
                  className={CHECKBOX_LABEL_CLASS}
                  htmlFor="trigger-file-event-change"
                >
                  <input
                    id="trigger-file-event-change"
                    data-testid="trigger-file-event-change"
                    type="checkbox"
                    checked={eventChange}
                    onChange={(e) => setEventChange(e.target.checked)}
                  />
                  change
                </label>
              </div>
            </div>
          )}

          {type === TriggerTypeWire.JobChain && (
            <div
              className="flex flex-col gap-3"
              data-testid="trigger-config-jobchain"
            >
              <label className={FIELD_CLASS} htmlFor="trigger-jobchain-on-kind">
                On job kind (optional)
                <select
                  id="trigger-jobchain-on-kind"
                  data-testid="trigger-jobchain-on-kind"
                  className={INPUT_CLASS}
                  value={onKind}
                  onChange={(e) => setOnKind(e.target.value)}
                >
                  <option value="">Any kind</option>
                  {JOB_KIND_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              <label className={FIELD_CLASS} htmlFor="trigger-jobchain-on-name">
                On job name (optional)
                <input
                  id="trigger-jobchain-on-name"
                  data-testid="trigger-jobchain-on-name"
                  className={INPUT_CLASS}
                  value={onName}
                  onChange={(e) => setOnName(e.target.value)}
                />
              </label>
              <label
                className={FIELD_CLASS}
                htmlFor="trigger-jobchain-on-status"
              >
                On status
                <select
                  id="trigger-jobchain-on-status"
                  data-testid="trigger-jobchain-on-status"
                  className={INPUT_CLASS}
                  value={onStatus}
                  onChange={(e) =>
                    setOnStatus(e.target.value as 'done' | 'failed')
                  }
                >
                  <option value="done">done</option>
                  <option value="failed">failed</option>
                </select>
              </label>
            </div>
          )}

          <label className={FIELD_CLASS} htmlFor="trigger-target-kind">
            Target job kind
            <select
              id="trigger-target-kind"
              data-testid="trigger-target-kind"
              className={INPUT_CLASS}
              value={targetKind}
              onChange={(e) => setTargetKind(e.target.value as JobKindWire)}
            >
              {JOB_KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>

          <label className={FIELD_CLASS} htmlFor="trigger-payload">
            Target payload (JSON)
            <textarea
              id="trigger-payload"
              data-testid="trigger-payload"
              className={`${INPUT_CLASS} h-24 resize-y`}
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-[var(--color-muted)]">
              {error}
            </p>
          )}

          <Button
            data-testid="trigger-create-submit"
            variant="accent"
            disabled={submitting || !name.trim()}
            onClick={() => void handleSubmit()}
          >
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[var(--color-fg)]">
            {/* SECURITY: plain interpolation only — see file-level note. */}
            Trigger <strong>{result.trigger.name}</strong> created.
          </p>

          {result.webhookToken && result.webhookUrl && (
            <TriggerWebhookOnceShown
              token={result.webhookToken}
              url={result.webhookUrl}
              copy={copy}
            />
          )}

          <Button
            data-testid="trigger-create-done"
            onClick={() => handleOpenChange(false)}
          >
            Done
          </Button>
        </div>
      )}
    </Dialog>
  );
}

/** The once-shown webhook token + URL panel — split out so the `result.
 *  webhookToken && result.webhookUrl &&` guard above narrows both to
 *  `string` for this component's props (TS can't narrow two independent
 *  optional properties across a nested JSX tree as cleanly as it narrows
 *  function-call arguments). */
function TriggerWebhookOnceShown({
  token,
  url,
  copy,
}: {
  token: string;
  url: string;
  copy: (value: string) => void;
}) {
  return (
    <>
      <p className="text-sm font-semibold text-[var(--color-accent)]">
        This token is shown once — copy it now. It will not be shown again.
      </p>

      <label className={FIELD_CLASS} htmlFor="trigger-webhook-url">
        Webhook URL
        <div className="flex gap-2">
          <input
            id="trigger-webhook-url"
            data-testid="trigger-webhook-url"
            readOnly
            className={`${INPUT_CLASS} flex-1`}
            value={url}
          />
          <Button onClick={() => copy(url)}>Copy</Button>
        </div>
      </label>

      <label className={FIELD_CLASS} htmlFor="trigger-webhook-token">
        Token
        <div className="flex gap-2">
          <input
            id="trigger-webhook-token"
            data-testid="trigger-webhook-token"
            readOnly
            className={`${INPUT_CLASS} flex-1`}
            value={token}
          />
          <Button onClick={() => copy(token)}>Copy</Button>
        </div>
      </label>
    </>
  );
}
