import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../../test/render.tsx';

describe('BuildersArea', () => {
  it('streams the local echo stub into a narration list on submit', async () => {
    renderAt('/builders');
    fireEvent.change(await screen.findByTestId('builders-need'), {
      target: { value: 'fetch stock quotes' },
    });
    fireEvent.click(screen.getByTestId('builders-submit'));
    await waitFor(() =>
      expect(
        screen.getByText('Received: "fetch stock quotes"'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText('Stub: real builder streaming lands in Increment 2.'),
    ).toBeInTheDocument();
  });
});
