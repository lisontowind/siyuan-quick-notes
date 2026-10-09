import type { KernelTransport } from '../types';
export class KernelError extends Error {
  constructor(message: string, public code: number) { super(message); }
}
export class SiYuanApi implements KernelTransport {
  async post<T>(path: string, body: unknown = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) throw new Error(`内核 HTTP ${response.status}`);
      const result = await response.json() as { code: number; msg: string; data: T };
      if (result.code !== 0) throw new KernelError(result.msg || '内核请求失败', result.code);
      return result.data;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('内核请求超时，保存结果需要核对');
      throw error;
    } finally { clearTimeout(timer); }
  }
}
