import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_BYTES, imageFormat, imageMarkdown, validImages } from '../src/core/images';
import { validRequest } from '../src/core/protocol';
import { ImageUploadService } from '../src/services/images';
import { bindImageInputs, readImages } from '../src/window/images';

const png = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
const image = (name = '截图.png') => ({ name, data: png() });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('image inputs and kernel upload', () => {
  it('accepts only bounded binary uploads from the current session', () => {
    const request = { session: 's', windowId: 'w', requestId: 'r', action: 'upload-images', images: [image()] };
    expect(validRequest(request, 's')).toBe(true); expect(validRequest(request, 'other')).toBe(false);
    for (const images of [[], Array(11).fill(image()), [{ name: 'x', data: 'base64' }], [{ name: 'x', data: new ArrayBuffer(0) }], [{ name: 'x', data: new ArrayBuffer(MAX_IMAGE_BYTES + 1) }]]) {
      expect(validRequest({ ...request, images }, 's')).toBe(false);
    }
    expect(validImages([image('x'.repeat(256))])).toBe(false);
  });
  it('identifies supported formats by bytes and rejects renamed HTML or SVG', () => {
    expect(imageFormat(png()).extension).toBe('png');
    for (const [bytes, extension] of [[new Uint8Array([255, 216, 255]), 'jpg'], [new TextEncoder().encode('GIF89a'), 'gif'], [new TextEncoder().encode('RIFF1234WEBP'), 'webp'], [new TextEncoder().encode('BM'), 'bmp']] as const) {
      expect(imageFormat(bytes.buffer as ArrayBuffer).extension).toBe(extension);
    }
    expect(() => imageFormat(new TextEncoder().encode('<svg/>').buffer)).toThrow('仅支持');
  });
  it('bounds file input before reading and rejects unsupported content', async () => {
    await expect(readImages([new File([png()], 'screenshot.png')])).resolves.toEqual([image('screenshot.png')]);
    await expect(readImages([new File(['<svg/>'], 'pretend.png', { type: 'image/png' })])).rejects.toThrow('仅支持');
    const arrayBuffer = vi.fn();
    await expect(readImages([{ size: MAX_IMAGE_BYTES + 1, arrayBuffer } as unknown as File])).rejects.toThrow('20 MB');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
  it('escapes labels and rejects paths outside the resource directory', () => {
    expect(imageMarkdown('a](x)\n.png', 'assets/a(b)#c.png')).toBe('![a\\]\\(x\\).png](assets/a%28b%29%23c.png)');
    for (const path of ['https://x/a.png', '/assets/a.png', 'assets/../a.png', 'assets/a\\b.png', 'assets/a\n.png', undefined]) {
      expect(() => imageMarkdown('image', path)).toThrow('路径无效');
    }
  });
  it('uses multipart credentials, global assets, and distinct names for duplicate files', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData, files = form.getAll('file[]') as File[];
      expect(form.get('assetsDirPath')).toBe('/assets/'); expect(new Set(files.map(file => file.name)).size).toBe(2);
      expect(files.every(file => file.type === 'image/png')).toBe(true);
      expect(init.headers).toBeUndefined(); expect(init.credentials).toBe('same-origin');
      return { ok: true, json: async () => ({ code: 0, data: { succMap: Object.fromEntries(files.map((file, index) => [file.name, `assets/image-${index}.png`])) } }) };
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(new ImageUploadService().upload([image('same.png'), image('same.png')])).resolves.toBe('![same.png](assets/image-0.png)\n\n![same.png](assets/image-1.png)');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    { code: -1, msg: 'disk full' },
    { code: 0, data: { errFiles: ['file.png'] } },
    { code: 0, data: { succMap: {} } },
    { code: 0, data: null },
  ])('never returns a broken image for failed or incomplete results: %j', async result => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => result }));
    await expect(new ImageUploadService().upload([image()])).rejects.toThrow();
  });
  it('times out stalled uploads and rejects unsupported images without a request', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))));
    vi.stubGlobal('fetch', fetcher);
    const checking = expect(new ImageUploadService().upload([image()])).rejects.toThrow('上传超时');
    await vi.advanceTimersByTimeAsync(30000); await checking;
    fetcher.mockClear();
    await expect(new ImageUploadService().upload([{ name: 'x.png', data: new TextEncoder().encode('<html>').buffer }])).rejects.toThrow('仅支持');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves ordinary paste and routes image paste, file selection and drop once', () => {
    const handlers = new Map<string, (event: any) => void>();
    const editor = { addEventListener: (name: string, fn: (event: any) => void) => handlers.set(name, fn) } as unknown as HTMLElement;
    const pickerHandlers = new Map<string, () => void>(), click = vi.fn();
    const file = new File([png()], 'x.png');
    const picker = { files: [file], value: 'x.png', click, addEventListener: (name: string, fn: () => void) => pickerHandlers.set(name, fn) } as unknown as HTMLInputElement;
    const buttonHandlers = new Map<string, () => void>();
    const button = { addEventListener: (name: string, fn: () => void) => buttonHandlers.set(name, fn) } as unknown as HTMLElement;
    const insert = vi.fn(), preventDefault = vi.fn(), stopPropagation = vi.fn();
    bindImageInputs(editor, picker, button, insert);
    handlers.get('paste')!({ clipboardData: { files: [] }, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    handlers.get('paste')!({ clipboardData: { files: [file] }, preventDefault, stopPropagation });
    handlers.get('drop')!({ dataTransfer: { files: [file] }, clientX: 10, clientY: 20, preventDefault, stopPropagation });
    buttonHandlers.get('click')!(); expect(click).toHaveBeenCalledOnce();
    pickerHandlers.get('change')!(); expect(picker.value).toBe('');
    expect(insert.mock.calls).toEqual([[[file]], [[file], { x: 10, y: 20 }], [[file]]]);
  });
});
