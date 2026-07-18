import { describe, expect, it, vi } from 'vitest';
import { downloadBlob } from './download.ts';

describe('downloadBlob', () => {
  it('creates an object URL, clicks a synthetic download anchor, then revokes the URL', () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    downloadBlob('session-abc.md', '# hello', 'text/markdown;charset=utf-8');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const [blobArg] = createObjectURL.mock.calls[0] as [Blob];
    expect(blobArg.type).toBe('text/markdown;charset=utf-8');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    click.mockRestore();
  });

  it('sets the anchor download attribute to the given filename before clicking', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let capturedDownload: string | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      capturedDownload = this.download;
    });

    downloadBlob('session-abc.md', 'text', 'text/markdown');
    expect(capturedDownload).toBe('session-abc.md');
    vi.restoreAllMocks();
  });

  it('removes the synthetic anchor from the DOM after clicking (no leaked nodes)', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      () => undefined,
    );
    const before = document.body.childElementCount;
    downloadBlob('f.md', 't', 'text/markdown');
    expect(document.body.childElementCount).toBe(before);
    vi.restoreAllMocks();
  });
});
