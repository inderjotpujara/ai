import { randomBytes } from 'node:crypto';
import { StatusEventType } from '../../contracts/enums.ts';
import type { EventSink } from '../../core/events.ts';

export type ConfirmAsk = { kind: string; question: string };

/** The consent port: mint a prompt, emit a `data-confirm` event through the
 *  caller's sink, and return a Promise that settles when the user (via
 *  `POST /api/runs/:id/respond`) answers. */
export type ConfirmPort = (
  ask: ConfirmAsk,
  emit: EventSink,
) => Promise<unknown>;

export type ConsentRegistry = {
  port: ConfirmPort;
  /** Settle a pending prompt with the user's answer. Returns false if the
   *  promptId is unknown or was already settled (second-resolve is a no-op). */
  resolve(promptId: string, value: unknown): boolean;
  /** The promptIds currently awaiting an answer. */
  pending(): string[];
};

/**
 * Server-wide registry of in-flight consent prompts, keyed by an unguessable
 * promptId. `port` is the write side the engine calls to ask a question;
 * `resolve` is the read side `POST /api/runs/:id/respond` calls to answer it.
 * Not yet per-run scoped — see `respond.ts` for that deferral note.
 */
export function createConsentRegistry(): ConsentRegistry {
  const pendingResolvers = new Map<string, (value: unknown) => void>();

  const port: ConfirmPort = (ask, emit) => {
    const promptId = randomBytes(32).toString('hex');
    return new Promise<unknown>((resolve) => {
      pendingResolvers.set(promptId, resolve);
      emit({
        type: StatusEventType.Confirm,
        promptId,
        kind: ask.kind,
        question: ask.question,
      });
    });
  };

  const resolve = (promptId: string, value: unknown): boolean => {
    const resolver = pendingResolvers.get(promptId);
    if (!resolver) return false; // unknown OR already-settled
    pendingResolvers.delete(promptId); // second resolve() is a no-op
    resolver(value);
    return true;
  };

  const pending = (): string[] => [...pendingResolvers.keys()];

  return { port, resolve, pending };
}
