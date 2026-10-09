interface OwnedTray {
  isDestroyed(): boolean;
  removeAllListeners(): void;
  destroy(): void;
}
interface OwnerContents {
  isDestroyed(): boolean;
  on(event: string, listener: (...args: any[]) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
}

/** Loaded through remote.require so every lifecycle callback runs in the main
 * process, even when the renderer is destroyed without DOM unload events. */
export function attachTrayLifetime(tray: OwnedTray, owner: OwnerContents): { stop(): void } {
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    owner.removeListener('destroyed', stop);
    owner.removeListener('render-process-gone', stop);
    owner.removeListener('did-navigate', stop);
    // Always attempt destruction, even if listener cleanup fails.
    try { tray.removeAllListeners(); }
    finally { if (!tray.isDestroyed()) tray.destroy(); }
  };
  try {
    if (owner.isDestroyed()) stop();
    else {
      owner.on('destroyed', stop);
      owner.on('render-process-gone', stop);
      // A committed main-frame navigation ends the old workspace document.
      // Unlike navigation start, it cannot be cancelled by beforeunload.
      owner.on('did-navigate', stop);
    }
  } catch (error) { stop(); throw error; }
  return { stop };
}
