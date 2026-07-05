/** Thrown by an open circuit breaker: the dependency is being given a rest. */
export class CircuitOpenError extends Error {
  constructor(readonly dependencyId: string) {
    super(`circuit open for dependency "${dependencyId}"`);
    this.name = 'CircuitOpenError';
  }
}
