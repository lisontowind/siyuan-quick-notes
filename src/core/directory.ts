function checkPath(directory: string): void {
  if (!directory.startsWith('/') || /[\x00-\x1f\x7f]/.test(directory)
    || directory.split('/').some(part => part === '.' || part === '..') || directory.includes('//')) {
    throw new Error('保存目录无效：请使用以 / 开头的目录，且不含控制字符、连续斜杠或 .、.. 路径段');
  }
}

export function normalizeDirectoryInput(value: string): string {
  // Preserve string escapes inside Sprig expressions until the kernel renders them.
  const directory = value.trim();
  const hasTemplate = directory.includes('{{') || directory.includes('}}');
  const normalized = hasTemplate ? directory : directory.replace(/\\/g, '/');
  if (/[\x00-\x1f\x7f]/.test(normalized)) throw new Error('保存目录无效：不能包含控制字符');
  checkPath(hasTemplate ? normalized.replace(/\{\{.*?\}\}/g, 'template') : normalized);
  return normalized;
}

export function normalizeResolvedDirectory(value: unknown): string {
  if (typeof value !== 'string') throw new Error('保存目录模板未返回有效路径');
  const directory = value.trim().replace(/\\/g, '/').replace(/\/+$/, '') || (value.trim().startsWith('/') ? '/' : '');
  try { checkPath(directory); }
  catch (error) { throw new Error(`保存目录模板解析结果无效：${(error as Error).message}`); }
  if (directory.includes('{{') || directory.includes('}}')) throw new Error('保存目录模板解析结果无效：仍包含未解析的表达式');
  return directory;
}
