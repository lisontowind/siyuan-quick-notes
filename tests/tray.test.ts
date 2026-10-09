import { describe, it, expect, vi } from 'vitest';
import { TrayAdapter, type TrayActions } from '../src/platform/tray';
import { attachTrayLifetime } from '../src/platform/tray-lifetime';
import { EventEmitter } from 'node:events';

class FakeTray {
  static instances: FakeTray[] = [];
  handlers = new Map<string, () => void>();
  destroyed = false;
  tooltip = '';
  menus: any[] = [];
  destroy = vi.fn(() => { this.destroyed = true; });
  constructor(readonly icon: string) { FakeTray.instances.push(this); }
  on(event: string, fn: () => void) { this.handlers.set(event, fn); }
  removeAllListeners() { this.handlers.clear(); }
  setToolTip(text: string) { this.tooltip = text; }
  popUpContextMenu(menu: unknown) { this.menus.push(menu); }
  isDestroyed() { return this.destroyed; }
}
function setup() {
  FakeTray.instances = [];
  const actions: TrayActions = { createNote: vi.fn(), recent: vi.fn(), settings: vi.fn(), windows: vi.fn(() => []), focusWindow: vi.fn(), showOwner: vi.fn() };
  const report = vi.fn();
  const contents = Object.assign(new EventEmitter(), { isDestroyed: (): boolean => false });
  const remote = { Tray: FakeTray, Menu: { buildFromTemplate: vi.fn((template: any) => template) },
    require: vi.fn(() => ({ attachTrayLifetime })), getCurrentWebContents: () => contents };
  const owner = new EventTarget();
  const adapter = new TrayAdapter(remote, actions, report, owner, '/plugin/tray-lifetime.cjs');
  return { actions, report, remote, adapter, owner, contents };
}
describe('independent quick-note tray', () => {
  it.each(['destroyed', 'render-process-gone', 'did-navigate'])('destroys the icon on native owner %s without DOM or plugin unload', event => {
    const { adapter, actions, remote, contents } = setup(); adapter.start('tray.ico', 'Test');
    expect(remote.require).toHaveBeenCalledWith('/plugin/tray-lifetime.cjs');
    const tray = FakeTray.instances[0], staleClick = tray.handlers.get('click')!;
    contents.emit(event);
    expect(tray.destroy).toHaveBeenCalledOnce(); expect(tray.handlers.size).toBe(0);
    expect(contents.eventNames()).toEqual([]);
    staleClick(); expect(actions.createNote).not.toHaveBeenCalled();
    adapter.stop(); expect(tray.destroy).toHaveBeenCalledOnce();
  });
  it('keeps the icon during cancelled navigation, subframe and same-document navigation', () => {
    const { adapter, contents } = setup(); adapter.start('tray.ico', 'Test');
    for (const event of ['close', 'will-navigate', 'did-start-navigation', 'did-frame-navigate', 'did-navigate-in-page']) contents.emit(event);
    expect(FakeTray.instances[0].destroy).not.toHaveBeenCalled(); adapter.stop();
    expect(contents.eventNames()).toEqual([]);
  });
  it('does not leave an icon when the main-process lifetime module cannot be loaded', () => {
    const { adapter, remote, owner } = setup();
    remote.require.mockImplementationOnce(() => { throw new Error('lifetime unavailable'); });
    expect(() => adapter.start('tray.ico', 'Test')).toThrow('lifetime unavailable');
    expect(FakeTray.instances[0].destroy).toHaveBeenCalledOnce();
    owner.dispatchEvent(new Event('unload'));
    adapter.start('tray.ico', 'Test'); expect(FakeTray.instances).toHaveLength(2); adapter.stop();
  });
  it('never attaches an icon to already destroyed native contents', () => {
    const { adapter, contents } = setup(); contents.isDestroyed = () => true;
    adapter.start('tray.ico', 'Test');
    expect(FakeTray.instances[0].destroy).toHaveBeenCalledOnce(); expect(contents.eventNames()).toEqual([]);
    adapter.start('tray.ico', 'Test'); expect(FakeTray.instances).toHaveLength(1);
  });
  it.each(['pagehide', 'unload'])('destroys the icon on owner %s without plugin unload', event => {
    const { adapter, actions, owner } = setup(); adapter.start('tray.ico', 'Test');
    const tray = FakeTray.instances[0];
    tray.handlers.get('right-click')!(); const staleClick = tray.menus[0][0].click;
    owner.dispatchEvent(new Event(event));
    expect(tray.destroy).toHaveBeenCalledOnce(); expect(tray.handlers.size).toBe(0);
    staleClick(); expect(actions.createNote).not.toHaveBeenCalled();
    owner.dispatchEvent(new Event('unload')); adapter.stop();
    expect(tray.destroy).toHaveBeenCalledOnce();
    adapter.start('tray.ico', 'Test'); expect(FakeTray.instances).toHaveLength(1);
  });
  it('keeps the icon on a cancellable close and while the workspace is hidden', () => {
    const { adapter, owner } = setup(); adapter.start('tray.ico', 'Test');
    const close = new Event('beforeunload', { cancelable: true }); close.preventDefault();
    owner.dispatchEvent(close); owner.dispatchEvent(new Event('blur'));
    owner.dispatchEvent(new Event('visibilitychange'));
    expect(FakeTray.instances[0].destroy).not.toHaveBeenCalled(); adapter.stop();
  });
  it('removes owner listeners on disable and reinstalls them on re-enable', () => {
    const { adapter, owner } = setup(); adapter.start('tray.ico', 'Test'); adapter.stop();
    owner.dispatchEvent(new Event('pagehide'));
    adapter.start('tray.ico', 'Test'); expect(FakeTray.instances).toHaveLength(2);
    owner.dispatchEvent(new Event('pagehide'));
    expect(FakeTray.instances[1].destroy).toHaveBeenCalledOnce();
  });
  it('creates one owned icon, handles left click, and does not show the main window for new notes', () => {
    const { adapter, actions } = setup(); adapter.start('plugin/tray.ico', 'Test'); adapter.start('plugin/tray.ico', 'Test');
    expect(FakeTray.instances).toHaveLength(1);
    const tray = FakeTray.instances[0]; expect(tray.icon).toBe('plugin/tray.ico'); expect(tray.tooltip).toContain('Test');
    tray.handlers.get('click')!(); expect(actions.createNote).toHaveBeenCalledOnce(); expect(actions.showOwner).not.toHaveBeenCalled();
    adapter.stop();
  });
  it('rebuilds the window list on right click and routes menus with the correct window ID', () => {
    const { adapter, actions } = setup(); adapter.start('tray.ico', 'Test'); const tray = FakeTray.instances[0];
    tray.handlers.get('right-click')!(); expect(tray.menus[0][2].submenu[0].enabled).toBe(false);
    vi.mocked(actions.windows).mockReturnValue([{ id: 'new-window', label: 'A & B' }]);
    tray.handlers.get('right-click')!(); const menu = tray.menus[1];
    expect(menu[2].label).toBe('管理速记窗口（1）'); expect(menu[2].submenu[0].label).toBe('A && B');
    menu[2].submenu[0].click(); expect(actions.focusWindow).toHaveBeenCalledWith('new-window');
    menu[1].click(); expect(actions.showOwner).toHaveBeenCalledOnce(); expect(actions.recent).toHaveBeenCalledOnce();
    menu[4].click(); expect(actions.settings).toHaveBeenCalledOnce(); adapter.stop();
  });
  it('cleans up idempotently and ignores stale callbacks after reload', () => {
    const { adapter, actions } = setup(); adapter.start('tray.ico', 'Test'); const first = FakeTray.instances[0];
    first.handlers.get('right-click')!(); const staleClick = first.menus[0][0].click;
    adapter.stop(); adapter.stop(); expect(first.destroy).toHaveBeenCalledOnce(); expect(first.handlers.size).toBe(0);
    adapter.start('tray.ico', 'Test'); staleClick(); expect(actions.createNote).not.toHaveBeenCalled();
    FakeTray.instances[1].handlers.get('click')!(); expect(actions.createNote).toHaveBeenCalledOnce(); adapter.stop();
  });
  it('reports asynchronous action failures and rolls back partially initialized icons', async () => {
    const { adapter, actions, report } = setup(); vi.mocked(actions.createNote).mockRejectedValue(new Error('cannot create'));
    adapter.start('tray.ico', 'Test'); FakeTray.instances[0].handlers.get('click')!(); await Promise.resolve();
    expect(report).toHaveBeenCalledWith(expect.stringContaining('cannot create')); adapter.stop();
    const tooltip = vi.spyOn(FakeTray.prototype, 'setToolTip').mockImplementationOnce(() => { throw new Error('shell unavailable'); });
    expect(() => adapter.start('tray.ico', 'Test')).toThrow('shell unavailable');
    expect(FakeTray.instances.at(-1)?.destroyed).toBe(true); tooltip.mockRestore();
  });
});
