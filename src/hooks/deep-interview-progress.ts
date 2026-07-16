export interface DeepInterviewProgress {
  round: number;
  target: string;
  ambiguity: number;
  readiness_gate: string;
}

export interface DeepInterviewProgressValidation {
  ok: boolean;
  missing: string[];
  progress?: DeepInterviewProgress;
}

function splitMarkdownRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isMarkdownSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/** Parse the compact, user-visible deep-interview progress table. */
export function validateDeepInterviewProgress(message: string): DeepInterviewProgressValidation {
  const rows = message
    .split(/\r?\n/)
    .filter((line) => line.includes('|'))
    .map(splitMarkdownRow);
  const headerIndex = rows.findIndex((cells) => {
    const normalized = cells.map((cell) => cell.toLowerCase().replace(/[-_\s]/g, ''));
    return normalized.includes('round')
      && normalized.includes('target')
      && normalized.includes('ambiguity')
      && normalized.some((cell) => cell === 'readinessgate' || cell === 'readiness');
  });
  if (headerIndex < 0) return { ok: false, missing: ['progress table'] };

  const header = rows[headerIndex].map((cell) => cell.toLowerCase().replace(/[-_\s]/g, ''));
  const data = rows.slice(headerIndex + 1).find((cells) => !isMarkdownSeparator(cells));
  if (!data) return { ok: false, missing: ['progress row'] };

  const valueAt = (name: string) => data[header.indexOf(name)]?.trim() ?? '';
  const roundText = valueAt('round');
  const target = valueAt('target');
  const ambiguityText = valueAt('ambiguity');
  const readinessGate = valueAt('readinessgate') || valueAt('readiness');
  const round = Number.parseInt(roundText, 10);
  const ambiguityMatch = /^(\d+(?:\.\d+)?)\s*%$/.exec(ambiguityText);
  const ambiguityPercent = ambiguityMatch ? Number.parseFloat(ambiguityMatch[1]) : Number.NaN;
  const missing = [
    ...(Number.isInteger(round) && round > 0 ? [] : ['round']),
    ...(target ? [] : ['target']),
    ...(Number.isFinite(ambiguityPercent) && ambiguityPercent >= 0 && ambiguityPercent <= 100 ? [] : ['ambiguity']),
    ...(readinessGate ? [] : ['readiness gate']),
  ];
  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    missing: [],
    progress: {
      round,
      target,
      ambiguity: ambiguityPercent / 100,
      readiness_gate: readinessGate,
    },
  };
}
