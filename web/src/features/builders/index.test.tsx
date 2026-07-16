import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../../test/render.tsx';

describe('BuildersArea', () => {
  it('defaults to the Agent wizard and can switch to Crew/Workflow', async () => {
    renderAt('/builders');
    expect(await screen.findByTestId('area-builders')).toBeInTheDocument();
    expect(screen.getByText('Agent Builder')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('builders-mode-crew'));

    expect(
      await screen.findByText('Crew / Workflow Builder'),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId('builder-wizard-crew'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Agent Builder')).not.toBeInTheDocument();
  });
});
