import type { ImageInput } from '../types';
import { imageFormat, imageMarkdown, validImages } from '../core/images';
import { KernelError } from './kernel';

export class ImageUploadService {
  async upload(images: ImageInput[]): Promise<string> {
    if (!validImages(images)) throw new Error('每次最多插入 10 张图片，总大小不超过 20 MB');
    const formats = images.map(image => imageFormat(image.data));
    const form = new FormData();
    form.append('assetsDirPath', '/assets/');
    // Unique names keep the legacy succMap response unambiguous for duplicate input names.
    const names = images.map((image, index) => {
      const name = `quick-note-${crypto.randomUUID()}.${formats[index].extension}`;
      form.append('file[]', new Blob([image.data], { type: formats[index].type }), name);
      return name;
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api/asset/upload', { method: 'POST', credentials: 'same-origin', body: form, signal: controller.signal });
      if (!response.ok) throw new Error(`图片上传 HTTP ${response.status}`);
      const result = await response.json() as { code: number; msg?: string; data?: { errFiles?: string[]; succMap?: Record<string, string> } };
      if (result.code !== 0) throw new KernelError(result.msg || '图片上传失败', result.code);
      if (result.data?.errFiles?.length) throw new Error(result.msg || '部分图片上传失败，请重新选择图片');
      return names.map((name, index) => imageMarkdown(images[index].name, result.data?.succMap?.[name])).join('\n\n');
    } catch (error) {
      if (controller.signal.aborted) throw new Error('图片上传超时，请重新插入图片');
      throw error;
    } finally { clearTimeout(timer); }
  }
}
