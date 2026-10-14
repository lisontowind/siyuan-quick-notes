import { IMAGE_ACCEPT, MAX_IMAGE_BYTES, MAX_IMAGES, imageFormat } from '../core/images';
import type { ImageInput } from '../types';

export async function readImages(files: File[]): Promise<ImageInput[]> {
  if (!files.length || files.length > MAX_IMAGES || files.some(file => !file.size)
    || files.reduce((sum, file) => sum + file.size, 0) > MAX_IMAGE_BYTES) {
    throw new Error('每次最多插入 10 张图片，总大小不超过 20 MB');
  }
  return Promise.all(files.map(async file => {
    const data = await file.arrayBuffer(); imageFormat(data);
    return { name: file.name.slice(0, 255) || '截图', data };
  }));
}
export function bindImageInputs(editor: HTMLElement, picker: HTMLInputElement, button: HTMLElement,
  insert: (files: File[], point?: { x: number; y: number }) => void): void {
  picker.accept = IMAGE_ACCEPT;
  button.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    const files = Array.from(picker.files ?? []); picker.value = '';
    if (files.length) insert(files);
  });
  editor.addEventListener('paste', event => {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length) return;
    event.preventDefault(); event.stopPropagation(); insert(files);
  }, true);
  editor.addEventListener('dragover', event => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  editor.addEventListener('drop', event => {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return;
    event.preventDefault(); event.stopPropagation(); insert(files, { x: event.clientX, y: event.clientY });
  }, true);
}
