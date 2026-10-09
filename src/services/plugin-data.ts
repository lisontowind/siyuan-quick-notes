// Plugin.saveData resolves an HTTP envelope even when its kernel operation fails.
export function assertPluginWrite(value: unknown): void {
  if (!value || typeof value !== 'object' || !('code' in value) || value.code !== 0) {
    const text = value && typeof value === 'object' && 'msg' in value ? String(value.msg) : '插件配置保存未得到内核确认';
    throw new Error(text);
  }
}
