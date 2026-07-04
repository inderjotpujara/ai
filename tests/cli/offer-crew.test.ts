import { describe, expect, it } from 'bun:test';
import { shouldOfferCrew } from '../../src/cli/offer-crew.ts';

describe('shouldOfferCrew', () => {
  it('routes multi-step phrasing to the crew-builder', () => {
    expect(shouldOfferCrew('fetch a page then summarize then email it')).toBe(
      true,
    );
  });

  it('routes a single capability to the agent-builder', () => {
    expect(shouldOfferCrew('extract text from a pdf')).toBe(false);
  });

  it('matches "steps" and "workflow" signals', () => {
    expect(shouldOfferCrew('a workflow with several steps')).toBe(true);
  });

  it('matches "team" and "crew" signals', () => {
    expect(shouldOfferCrew('a team of agents to review a crew of PRs')).toBe(
      true,
    );
  });

  it('matches "pipeline" and "after that" signals', () => {
    expect(shouldOfferCrew('build a pipeline; after that notify slack')).toBe(
      true,
    );
  });

  it('is case-insensitive', () => {
    expect(shouldOfferCrew('Then send an email')).toBe(true);
  });
});
