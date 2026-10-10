import { describe, it, expect } from 'vitest';
import { parseSettings } from '../src/core/settings';
import { SerialQueue, TriggerGate } from '../src/core/serial';
import { validRequest } from '../src/core/protocol';
import { assertPluginWrite } from '../src/services/plugin-data';

describe('configuration and coordination', () => {
  it('does not report settings saved when Plugin.saveData resolves a failed envelope', () => {
    expect(() => assertPluginWrite({ code: 0, data: null })).not.toThrow();
    expect(() => assertPluginWrite({ code: -1, msg: 'disk error' })).toThrow('disk error');
    expect(() => assertPluginWrite(undefined)).toThrow('内核确认');
  });
  it('normalizes persisted settings and rejects unsafe paths', () => {
    expect(parseSettings(null).width).toBe(320);
    const result = parseSettings({ width: -2, height: Infinity, directory: '/../escape', debounceMs: 0, maxWindows: 2 });
    expect(result.width).toBe(300); expect(result.height).toBe(320); expect(result.directory).toBe('/闪念速记/{{now | date "20060102150405"}}');
    expect(parseSettings(null).directory).toBe('/闪念速记/{{now | date "20060102150405"}}');
    expect(result.debounceMs).toBe(100); expect(result.maxWindows).toBe(2);
    expect(parseSettings(null).maxWindows).toBe(10);
    expect(parseSettings({ maxWindows: 'invalid' }).maxWindows).toBe(10);
    expect(parseSettings({ maxWindows: 0 }).maxWindows).toBe(1);
    expect(parseSettings({ maxWindows: 999 }).maxWindows).toBe(50);
    expect(parseSettings({ maxWindows: 20 }).maxWindows).toBe(20);
    expect(parseSettings(null).historyLimit).toBe(50);
    expect(parseSettings({ historyLimit: 0 }).historyLimit).toBe(1);
    expect(parseSettings({ historyLimit: 9999 }).historyLimit).toBe(200);
    expect(parseSettings({ historyLimit: 42.4 }).historyLimit).toBe(42);
    expect(parseSettings({ historyLimit: NaN }).historyLimit).toBe(50);
    const directory = '/Quick Notes/{{now | date "2006/01"}}';
    expect(parseSettings({ directory }).directory).toBe(directory);
    expect(parseSettings({ directory: '/Quick Notes/{{printf "%s" "a\\\\b"}}' }).directory).toBe('/Quick Notes/{{printf "%s" "a\\\\b"}}');
    expect(parseSettings({ directory: '/Quick Notes\\folder' }).directory).toBe('/Quick Notes/folder');
    expect(parseSettings({ storageMode: 'shorthand' })).not.toHaveProperty('storageMode');
  });
  it('throttles repeated shortcuts and permits the next independent trigger', () => {
    const gate = new TriggerGate(); expect(gate.accept(0)).toBe(true); expect(gate.accept(499)).toBe(false); expect(gate.accept(500)).toBe(true);
  });
  it('serializes the same document, survives failures, and allows another document concurrently', async () => {
    const queue = new SerialQueue(); let release!: () => void; const events: string[] = [];
    const first = queue.run('a', async () => { events.push('first'); await new Promise<void>(resolve => { release = resolve; }); throw new Error('failed'); });
    const second = queue.run('a', async () => { events.push('second'); });
    await queue.run('b', async () => { events.push('other'); });
    expect(events).toEqual(['first', 'other']); release(); await expect(first).rejects.toThrow(); await second;
    expect(events).toEqual(['first', 'other', 'second']);
  });
  it('rejects cross-session messages and invalid edit revisions', () => {
    const request = { session: 'one', windowId: 'window', requestId: 'request', action: 'edit', text: 'hello', revision: 1 };
    expect(validRequest(request, 'one')).toBe(true); expect(validRequest(request, 'two')).toBe(false);
    expect(validRequest({ ...request, revision: NaN }, 'one')).toBe(false);
    expect(validRequest({ ...request, action: 'execute-code' }, 'one')).toBe(false);
    expect(validRequest({ ...request, action: 'collected' }, 'one')).toBe(true);
    expect(validRequest({ ...request, action: 'collected', text: undefined, revision: undefined, error: 'IME not ready' }, 'one')).toBe(true);
    expect(validRequest({ ...request, action: 'collected', text: undefined }, 'one')).toBe(false);
    expect(validRequest({ ...request, action: 'collected', text: 'x'.repeat(2_000_001) }, 'one')).toBe(false);
    expect(validRequest({ ...request, title: '中文标题' }, 'one')).toBe(true);
    expect(validRequest({ ...request, title: 123 }, 'one')).toBe(false);
    expect(validRequest({ ...request, title: 'x'.repeat(201) }, 'one')).toBe(false);
    expect(validRequest({ ...request, title: 'two\nlines' }, 'one')).toBe(false);
  });
});
