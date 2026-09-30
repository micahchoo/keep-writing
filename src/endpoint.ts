// The AI server, asked what it has before a question needs it.
//
// The model is on by default and its address is a local server most owners do
// not run. Until 2026-09-29 the first sign of that was a failed follow-up, so
// the owner's first meeting with the AI was an error. `GET /models` is the one
// request every OpenAI-compatible server answers — Ollama and LM Studio
// included — and its answer is the list the Model name setting should offer.
//
// Nothing here touches the vault, the DOM or `obsidian`: the fetcher is handed
// in, as it is to bonsai.ts.

import type { Fetcher } from './bonsai';

/** Ollama's OpenAI-compatible address, as it ships. */
export const OLLAMA_URL = 'http://localhost:11434/v1';
/** LM Studio's, as it ships. */
export const LMSTUDIO_URL = 'http://localhost:1234/v1';

/** Short: a server that is there answers a model list at once. */
const PROBE_TIMEOUT_MS = 3000;

export type Probe =
  | { kind: 'found'; baseUrl: string; models: string[] }
  | { kind: 'unreachable'; baseUrl: string; reason: string }
  | { kind: 'refused'; baseUrl: string; status: number };

/** Pure: the model ids in a `/models` reply, or null when it is not one. */
export function parseModels(text: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const data = (parsed as { data?: unknown })?.data;
  if (!Array.isArray(data)) return null;
  return data.map((m) => (m as { id?: unknown })?.id).filter((id): id is string => typeof id === 'string');
}

function trimmed(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** Ask one server for its models. Never throws: every outcome is a Probe. */
export async function probeServer(fetcher: Fetcher, baseUrl: string, apiKey = ''): Promise<Probe> {
  const base = trimmed(baseUrl);
  const headers: Record<string, string> = {};
  if (apiKey.trim()) headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`no answer in ${PROBE_TIMEOUT_MS / 1000} s`)), PROBE_TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([fetcher(`${base}/models`, { method: 'GET', headers }), timeout]);
    if (res.status < 200 || res.status >= 300) return { kind: 'refused', baseUrl: base, status: res.status };
    const models = parseModels(res.text);
    return models ? { kind: 'found', baseUrl: base, models } : { kind: 'unreachable', baseUrl: base, reason: 'the reply was not a model list' };
  } catch (e) {
    return { kind: 'unreachable', baseUrl: base, reason: e instanceof Error ? e.message : String(e) };
  }
  finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

/**
 * The address in settings first, then the usual local servers, each asked
 * once, all at the same time. The caller decides what to offer from the answers.
 */
export async function findServers(fetcher: Fetcher, configured: string, apiKey = ''): Promise<Probe[]> {
  const addresses = [...new Set([trimmed(configured), OLLAMA_URL, LMSTUDIO_URL])];
  return Promise.all(addresses.map((a) => probeServer(fetcher, a, a === trimmed(configured) ? apiKey : '')));
}

/** Pure: one sentence on what a probe found, for the model named in settings. */
export function probeLine(probe: Probe, model: string): string {
  switch (probe.kind) {
    case 'found': {
      const n = probe.models.length;
      const count = `${n} model${n === 1 ? '' : 's'}`;
      if (probe.models.includes(model)) return `Connected to ${probe.baseUrl}. It has ${count}, including ${model}.`;
      return `Connected to ${probe.baseUrl}, but it has no model named “${model}”. Choose one under Model name.`;
    }
    case 'unreachable':
      return `Nothing answered at ${probe.baseUrl} (${probe.reason}). Start your AI server, change the address, or turn AI questions off.`;
    case 'refused':
      return `${probe.baseUrl} answered with error ${probe.status}. If it needs an API key, enter one below.`;
  }
}

/** What settings shows after a check. */
export interface Advice {
  /** One sentence about the address in settings. */
  line: string;
  /** Its models, when it answered with a list: what Model name offers. */
  models: string[] | null;
  /** A usual local server that answered, when the one in settings did not. */
  other: Extract<Probe, { kind: 'found' }> | null;
}

/** Pure: from the answers of `findServers`, what to tell the owner and offer them. */
export function serverAdvice(probes: Probe[], configured: string, model: string): Advice {
  const base = trimmed(configured);
  const here: Probe = probes.find((p) => p.baseUrl === base) ?? { kind: 'unreachable', baseUrl: base, reason: 'not checked' };
  if (here.kind === 'found') return { line: probeLine(here, model), models: here.models, other: null };
  const other = probes.find((p): p is Extract<Probe, { kind: 'found' }> => p.kind === 'found' && p.models.length > 0) ?? null;
  return { line: probeLine(here, model), models: null, other };
}
