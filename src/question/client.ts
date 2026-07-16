import { spawn } from 'node:child_process';
import { resolveNomxCliEntryPath } from '../utils/paths.js';
import type { QuestionAnswer, QuestionAnswerEntry, QuestionInput, NormalizedQuestionItem } from './types.js';

export interface NomxQuestionSuccessPayload {
  ok: true;
  question_id: string;
  session_id?: string;
  questions: NormalizedQuestionItem[];
  answers: QuestionAnswerEntry[];
  prompt?: QuestionInput | NormalizedQuestionItem;
  question?: QuestionInput | NormalizedQuestionItem;
  answer?: QuestionAnswer;
}

export interface NomxQuestionErrorPayload {
  ok: false;
  question_id?: string;
  session_id?: string;
  error: {
    code: string;
    message: string;
  };
}

export type NomxQuestionPayload = NomxQuestionSuccessPayload | NomxQuestionErrorPayload;

export interface NomxQuestionClientOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  argv1?: string | null;
  runner?: NomxQuestionProcessRunner;
}

export interface NomxQuestionProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type NomxQuestionProcessRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<NomxQuestionProcessResult>;

export class NomxQuestionError extends Error {
  readonly code: string;
  readonly payload?: NomxQuestionErrorPayload;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(
    code: string,
    message: string,
    options: {
      payload?: NomxQuestionErrorPayload;
      stdout?: string;
      stderr?: string;
      exitCode?: number | null;
    } = {},
  ) {
    super(`${code}: ${message}`);
    this.name = 'NomxQuestionError';
    this.code = code;
    this.payload = options.payload;
    this.stdout = options.stdout ?? '';
    this.stderr = options.stderr ?? '';
    this.exitCode = options.exitCode ?? null;
  }
}

export async function defaultNomxQuestionProcessRunner(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<NomxQuestionProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function parseQuestionStdout(stdout: string, stderr: string, exitCode: number | null): NomxQuestionPayload {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new NomxQuestionError('question_no_stdout', 'nomx question did not emit a JSON response on stdout.', {
      stdout,
      stderr,
      exitCode,
    });
  }

  try {
    return JSON.parse(trimmed) as NomxQuestionPayload;
  } catch (error) {
    throw new NomxQuestionError(
      'question_invalid_stdout',
      `nomx question emitted invalid JSON on stdout: ${(error as Error).message}`,
      { stdout, stderr, exitCode },
    );
  }
}

export async function runNomxQuestion(
  input: (Partial<QuestionInput> & { question: string }) | { questions: Array<Partial<QuestionInput> & { question: string }>; header?: string; source?: string; session_id?: string },
  options: NomxQuestionClientOptions = {},
): Promise<NomxQuestionSuccessPayload> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const nomxBin = resolveNomxCliEntryPath({ argv1: options.argv1, cwd, env });
  if (!nomxBin) {
    throw new NomxQuestionError('question_cli_not_found', 'Could not resolve the nomx CLI entrypoint for blocking question execution.');
  }

  const runner = options.runner ?? defaultNomxQuestionProcessRunner;
  const result = await runner(
    process.execPath,
    [nomxBin, 'question', '--json', '--input', JSON.stringify(input)],
    { cwd, env },
  );
  const payload = parseQuestionStdout(result.stdout, result.stderr, result.code);

  if (!payload.ok) {
    throw new NomxQuestionError(payload.error.code, payload.error.message, {
      payload,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
    });
  }

  if (result.code !== 0) {
    throw new NomxQuestionError(
      'question_nonzero_exit',
      `nomx question returned an answer but exited with code ${result.code}.`,
      { stdout: result.stdout, stderr: result.stderr, exitCode: result.code },
    );
  }

  return payload;
}
