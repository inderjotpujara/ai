import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToastHost, useToast } from './toast.tsx';

function Trigger({ text }: { text: string }) {
  const { notify } = useToast();
  return (
    <button type="button" onClick={() => notify(text)}>
      fire
    </button>
  );
}

describe('ToastHost / useToast', () => {
  it('renders a toast after notify() is called', async () => {
    render(
      <ToastHost>
        <Trigger text="run finished" />
      </ToastHost>,
    );
    act(() => screen.getByRole('button', { name: 'fire' }).click());
    await waitFor(() =>
      expect(screen.getByText('run finished')).toBeInTheDocument(),
    );
  });

  it('supports multiple simultaneous toasts', async () => {
    render(
      <ToastHost>
        <Trigger text="first" />
        <Trigger text="second" />
      </ToastHost>,
    );
    const buttons = screen.getAllByRole('button', { name: 'fire' });
    act(() => buttons[0]?.click());
    act(() => buttons[1]?.click());
    await waitFor(() => {
      expect(screen.getByText('first')).toBeInTheDocument();
      expect(screen.getByText('second')).toBeInTheDocument();
    });
  });

  it('useToast throws when used outside ToastHost', () => {
    function Bare() {
      useToast();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(
      /useToast must be used within ToastHost/,
    );
  });
});
