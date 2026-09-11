import { LogLevel } from '@nestjs/common';

// Ordered from most to least severe
const SEVERITY: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];

const DEFAULT_ALIASES: Record<string, LogLevel> = {
  info: 'log',
  warning: 'warn',
  trace: 'verbose',
};

export function getLogLevels(minLevel: string, aliases: Record<string, LogLevel> = {}): LogLevel[] {
  const map = new Map<string, LogLevel>(
    Object.entries({ ...DEFAULT_ALIASES, ...aliases }).map(([k, v]) => [k.toLowerCase(), v]),
  );

  const name = minLevel.trim().toLowerCase();
  const resolved = map.get(name) ?? (name as LogLevel);
  const idx = SEVERITY.indexOf(resolved);

  if (idx === -1) {
    throw new Error(
      `Unknown log level "${minLevel}". Valid: ${[...SEVERITY, ...map.keys()].join(', ')}`,
    );
  }

  return SEVERITY.slice(0, idx + 1);
}
