import { EventEmitter } from 'events';

export interface MouseClickEvent {
  button: number; // 0 = left, 1 = middle, 2 = right
  col: number;    // 1-indexed column (X)
  row: number;    // 1-indexed row (Y)
  isPress: boolean;
  isRelease: boolean;
}

export interface HitBoxZone {
  id: string;
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
  onClick: (event: MouseClickEvent) => void;
}

/**
 * Parses raw ANSI SGR mouse sequence (mode 1006).
 * Format: \x1b[<button;col;row[M|m]
 *
 * @param input - Raw input string or chunk.
 * @returns Parsed MouseClickEvent or null if not a mouse sequence.
 */
export function parseSgrMouseEvent(input: string): MouseClickEvent | null {
  if (!input || !input.includes('\x1b[<')) {
    return null;
  }
  const match = input.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
  if (!match) {
    return null;
  }
  const button = parseInt(match[1], 10);
  const col = parseInt(match[2], 10);
  const row = parseInt(match[3], 10);
  const flag = match[4];

  return {
    button,
    col,
    row,
    isPress: flag === 'M',
    isRelease: flag === 'm',
  };
}

/**
 * TerminalMouseManager manages ANSI SGR 1006 mouse tracking,
 * hit-box registrations, and click event routing for the CLI TUI.
 */
export class TerminalMouseManager extends EventEmitter {
  private static instance: TerminalMouseManager | null = null;
  private isEnabled = false;
  private zones: Map<string, HitBoxZone> = new Map();
  private stdinListener: ((chunk: Buffer | string) => void) | null = null;

  public static getInstance(): TerminalMouseManager {
    if (!TerminalMouseManager.instance) {
      TerminalMouseManager.instance = new TerminalMouseManager();
    }
    return TerminalMouseManager.instance;
  }

  private constructor() {
    super();
    // Safety exit hooks to restore terminal mouse mode
    const cleanup = () => this.disable();
    process.once('exit', cleanup);
    process.once('SIGTERM', cleanup);

  }

  /**
   * Enables mouse manager in safe mode.
   * Preserves native terminal mouse scrolling so the terminal scrollback buffer
   * scrolls naturally without hijacking mouse wheel events into stdin.
   */
  public enable(): void {
    this.isEnabled = true;
  }

  /**
   * Disables mouse reporting and restores standard terminal behavior.
   */
  public disable(): void {
    if (!this.isEnabled) return;
    this.isEnabled = false;

    if (this.stdinListener) {
      process.stdin.removeListener('data', this.stdinListener);
      this.stdinListener = null;
    }

    if (process.stdout.isTTY) {
      try {
        process.stdout.write('\x1b[?1000l\x1b[?1006l');
      } catch {
        // Ignore if stdout is closed
      }
    }
  }

  /**

   * Registers a clickable hit-box zone on the terminal screen.
   */
  public registerZone(zone: HitBoxZone): void {
    this.zones.set(zone.id, zone);
  }

  /**
   * Unregisters a clickable zone.
   */
  public unregisterZone(id: string): void {
    this.zones.delete(id);
  }

  /**
   * Clears all registered click zones.
   */
  public clearZones(): void {
    this.zones.clear();
  }

  /**
   * Processes raw input string, extracting and dispatching mouse events.
   */
  public handleRawInput(input: string): boolean {
    const mouseEvent = parseSgrMouseEvent(input);
    if (!mouseEvent || !mouseEvent.isPress || mouseEvent.button !== 0) {
      return false;
    }

    this.emit('click', mouseEvent);

    for (const zone of this.zones.values()) {
      const inCol = mouseEvent.col >= zone.minCol && mouseEvent.col <= zone.maxCol;
      const inRow = mouseEvent.row >= zone.minRow && mouseEvent.row <= zone.maxRow;

      if (inCol && inRow) {
        zone.onClick(mouseEvent);
        return true;
      }
    }

    return false;
  }
}
