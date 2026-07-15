/** Pure, local stand-in for the real builder SSE stream (Increment 2 —
 *  `POST /api/builders/build` + `use-build-events.ts`). No network call: this
 *  scaffold only proves the wizard shell (textarea → narration list) renders
 *  and updates correctly before the real route exists. */
export async function* echoBuilderStub(need: string): AsyncGenerator<string> {
  yield `Received: "${need}"`;
  yield 'Stub: real builder streaming lands in Increment 2.';
}
