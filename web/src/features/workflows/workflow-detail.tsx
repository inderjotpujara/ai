import type { StepDTO, WorkflowDetailDTO } from '@contracts';
import { RunLaunchResponseSchema, WorkflowDetailDtoSchema } from '@contracts';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { DagView } from '../../shared/dag/dag-view.tsx';
import { workflowGraph } from '../../shared/dag/workflow-graph.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';

/** Route entry: mounts a fresh view per workflow via `key`, mirroring
 *  CrewDetail's remount-on-nav pattern (Phase 4 Task 15). */
export function WorkflowDetail() {
  const { workflowId } = useParams({ from: '/workflows/$workflowId' });
  return <WorkflowDetailView key={workflowId} workflowId={workflowId} />;
}

function WorkflowDetailView({ workflowId }: { workflowId: string }) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<WorkflowDetailDTO | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [input, setInput] = useState('');
  const [launching, setLaunching] = useState(false);
  const [selectedStep, setSelectedStep] = useState<StepDTO | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    setDetail(undefined);
    setError(undefined);
    setSelectedStep(undefined);
    apiFetch(`/workflows/${workflowId}`, { schema: WorkflowDetailDtoSchema })
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'failed to load workflow',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  async function handleRun() {
    setLaunching(true);
    try {
      const { runId } = await apiFetch(`/workflows/${workflowId}/run`, {
        method: 'POST',
        body: { input },
        schema: RunLaunchResponseSchema,
      });
      // Amendment A: reuse the /runs/$runId validateSearch already defined by
      // Task 15 (graphKind/graphId) — carry the workflow id so the live
      // overlay can join back to the same workflowGraph.
      navigate({
        to: '/runs/$runId',
        params: { runId },
        search: { graphKind: 'workflow', graphId: workflowId },
      });
    } catch (err: unknown) {
      setLaunching(false);
      setError(err instanceof Error ? err.message : 'failed to launch run');
    }
  }

  function handleNodeClick(nodeId: string) {
    setSelectedStep(detail?.steps.find((s) => s.id === nodeId));
  }

  return (
    <RegionErrorBoundary region="Workflow">
      <section
        data-testid="workflow-detail"
        className="flex h-full flex-col p-8"
      >
        <h1 className="font-mono text-lg text-[var(--color-fg)]">
          Workflow {workflowId}
        </h1>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
          >
            <strong className="text-[var(--color-fg)]">Workflow</strong> failed.{' '}
            {error}
          </div>
        )}

        {detail && (
          <>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              {detail.steps.length} steps
            </p>

            <div className="mt-4 flex flex-1 gap-4">
              <div className="flex-1">
                <DagView
                  model={workflowGraph(detail)}
                  onNodeClick={handleNodeClick}
                />
              </div>
              {selectedStep && (
                <aside
                  data-testid="step-detail"
                  aria-label="Selected step detail"
                  className="min-w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs text-[var(--color-fg)]"
                >
                  <div className="text-sm">{selectedStep.id}</div>
                  <div className="text-[var(--color-muted)]">
                    kind: {selectedStep.kind}
                  </div>
                  {selectedStep.agent && (
                    <div className="text-[var(--color-muted)]">
                      agent: {selectedStep.agent}
                    </div>
                  )}
                  {selectedStep.tool && (
                    <div className="text-[var(--color-muted)]">
                      tool: {selectedStep.tool}
                    </div>
                  )}
                </aside>
              )}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <input
                data-testid="workflow-run-input"
                type="text"
                placeholder="Input…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-sm text-[var(--color-fg)]"
              />
              <Button
                data-testid="workflow-run-button"
                variant="accent"
                disabled={launching || !input.trim()}
                onClick={handleRun}
              >
                {launching ? 'Launching…' : 'Run'}
              </Button>
            </div>
          </>
        )}
      </section>
    </RegionErrorBoundary>
  );
}
