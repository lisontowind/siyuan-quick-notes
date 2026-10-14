import type { ImageInput } from '../types';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGES = 10;
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,.png,.jpg,.jpeg,.gif,.webp,.bmp';
export function validImages(value: unknown): value is ImageInput[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_IMAGES) return false;
  let total = 0;
  return value.every(image => image && typeof image.name === 'string' && image.name.length <= 255
    && image.data instanceof ArrayBuffer && image.data.byteLength > 0
    && (total += image.data.byteLength) <= MAX_IMAGE_BYTES);
}
export function imageFormat(data: ArrayBuffer): { type: string; extension: string } {
  const bytes = new Uint8Array(data);
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return { type: 'image/png', extension: 'png' };
  if (starts(255, 216, 255)) return { type: 'image/jpeg', extension: 'jpg' };
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return { type: 'image/gif', extension: 'gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { type: 'image/webp', extension: 'webp' };
  if (starts(66, 77)) return { type: 'image/bmp', extension: 'bmp' };
  throw new Error('仅支持 PNG、JPEG、GIF、WebP 和 BMP 图片');
}
export function imageMarkdown(name: string, path: unknown): string {
  if (typeof path !== 'string' || !path.startsWith('assets/') || path.length > 1024
    || /[\\\u0000-\u0020<>]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('内核返回的图片资源路径无效');
  }
  const label = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\`*_{}\[\]()!<>]/g, '\\$&') || '截图';
  const url = path.split('/').map(part => encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/');
  return `![${label}](${url})`;
}
