import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../../test/render.tsx';

describe('BuildersArea', () => {
  it('defaults to the Agent wizard and can switch to Crew/Workflow', async () => {
    renderAt('/builders');
    expect(await screen.findByTestId('area-builders')).toBeInTheDocument();
    expect(screen.getByText('Agent Builder')).toBeInTheDocument();
  });
});
