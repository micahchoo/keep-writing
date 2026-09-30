import { describe, expect, test } from 'bun:test';
import { LMSTUDIO_URL, OLLAMA_URL, findServers, parseModels, probeLine, probeServer, serverAdvice } from '../src/endpoint';
import type { Fetcher } from '../src/bonsai';
import { modelFailureLine } from '../src/refusal';

// The model is on by default and points at a server almost nobody runs. Until
// 2026-09-29 the first sign of that was a failed follow-up: the owner's first
// meeting with the AI was an error. Asking the server what it has — before a
// question needs it — turns that into one plain sentence and a list to choose from.

/** Answers each URL from a table; a URL not in it is a refused connection. */
function fakeFetcher(table: Record<string, { status: number; text: string }>): Fetcher & { calls: { url: string; method: string; headers: Record<string, string> }[] } {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const f = (async (url: string, init: { method: string; headers: Record<string, string> }) => {
    calls.push({ url, method: init.method, headers: init.headers });
    const hit = table[url];
    if (!hit) throw new Error('net::ERR_CONNECTION_REFUSED');
    return hit;
  }) as Fetcher & { calls: typeof calls };
  f.calls = calls;
  return f;
}

const LIST = (...ids: string[]) => ({ status: 200, text: JSON.stringify({ object: 'list', data: ids.map((id) => ({ id, object: 'model' })) }) });

describe('parseModels', () => {
  test('reads the OpenAI shape, which Ollama and LM Studio also answer', () => {
    expect(parseModels(LIST('qwen3.8-27b', 'llama3').text)).toEqual(['qwen3.8-27b', 'llama3']);
  });
  test('anything else is no list at all', () => {
    expect(parseModels('<html>')).toBeNull();
    expect(parseModels('{"data": "no"}')).toBeNull();
  });
});

describe('probeServer', () => {
  test('asks GET <address>/models, with the key when there is one', async () => {
    const f = fakeFetcher({ 'http://h:1/v1/models': LIST('a') });
    expect(await probeServer(f, 'http://h:1/v1/', 'sk-1')).toEqual({ kind: 'found', baseUrl: 'http://h:1/v1', models: ['a'] });
    expect(f.calls[0]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer sk-1' } });
  });
  test('nothing listening is unreachable, with the reason', async () => {
    expect(await probeServer(fakeFetcher({}), 'http://h:1/v1')).toEqual({ kind: 'unreachable', baseUrl: 'http://h:1/v1', reason: 'net::ERR_CONNECTION_REFUSED' });
  });
  test('a server that says no is refused, with its status', async () => {
    const f = fakeFetcher({ 'http://h:1/v1/models': { status: 401, text: 'no key' } });
    expect(await probeServer(f, 'http://h:1/v1')).toEqual({ kind: 'refused', baseUrl: 'http://h:1/v1', status: 401 });
  });
});

describe('findServers', () => {
  test('tries the address in settings first, then the usual local servers, each once', async () => {
    const f = fakeFetcher({ [`${OLLAMA_URL}/models`]: LIST('llama3') });
    const found = await findServers(f, `${OLLAMA_URL}/`);
    expect(found.map((p) => p.baseUrl)).toEqual([OLLAMA_URL, LMSTUDIO_URL]);
    const other = await findServers(fakeFetcher({}), 'http://127.0.0.1:8088/v1');
    expect(other.map((p) => p.baseUrl)).toEqual(['http://127.0.0.1:8088/v1', OLLAMA_URL, LMSTUDIO_URL]);
  });
});

describe('probeLine', () => {
  const found = { kind: 'found' as const, baseUrl: 'http://h/v1', models: ['a', 'b', 'qwen'] };
  test('a server that has the model', () => {
    expect(probeLine(found, 'qwen')).toBe('Connected to http://h/v1. It has 3 models, including qwen.');
  });
  test('a server without the model says which to change', () => {
    expect(probeLine(found, 'nope')).toBe('Connected to http://h/v1, but it has no model named “nope”. Choose one under Model name.');
  });
  test('nothing there, or a refusal', () => {
    expect(probeLine({ kind: 'unreachable', baseUrl: 'http://h/v1', reason: 'net::ERR_CONNECTION_REFUSED' }, 'qwen'))
      .toBe('Nothing answered at http://h/v1 (net::ERR_CONNECTION_REFUSED). Start your AI server, change the address, or turn AI questions off.');
    expect(probeLine({ kind: 'refused', baseUrl: 'http://h/v1', status: 401 }, 'qwen'))
      .toBe('http://h/v1 answered with error 401. If it needs an API key, enter one below.');
  });
});

// A failed call said "The model did not answer." and the endpoint's words, and
// nothing about what to do. When nothing is listening, say where to fix it.
describe('a call that could not reach the server', () => {
  test('points at the settings', () => {
    expect(modelFailureLine('net::ERR_CONNECTION_REFUSED')).toBe(
      'The model did not answer. net::ERR_CONNECTION_REFUSED Check the server in keep-writing’s settings, or turn AI questions off.',
    );
    expect(modelFailureLine('timeout after 30000 ms')).toContain('Check the server in keep-writing’s settings');
  });
  test('a server that answered is left to say its own words', () => {
    expect(modelFailureLine("HTTP 404: model 'nope' not found")).toBe("The model did not answer. HTTP 404: model 'nope' not found");
  });
});

// What settings shows after a check: one line about the address in use, the
// models to choose from there, and another server when the one in settings is
// not answering but a usual local one is.
describe('serverAdvice', () => {
  const here = 'http://127.0.0.1:8088/v1';
  const down = { kind: 'unreachable' as const, baseUrl: here, reason: 'net::ERR_CONNECTION_REFUSED' };
  const ollama = { kind: 'found' as const, baseUrl: OLLAMA_URL, models: ['llama3', 'qwen3'] };

  test('the address in settings answers: its models, and no other server offered', () => {
    const ok = { kind: 'found' as const, baseUrl: here, models: ['qwen3.8-27b'] };
    expect(serverAdvice([ok, ollama], here, 'qwen3.8-27b')).toEqual({ line: probeLine(ok, 'qwen3.8-27b'), models: ['qwen3.8-27b'], other: null });
  });
  test('it does not, and Ollama does: offer Ollama', () => {
    expect(serverAdvice([down, ollama], here, 'qwen3.8-27b')).toEqual({ line: probeLine(down, 'qwen3.8-27b'), models: null, other: ollama });
  });
  test('nothing answers anywhere', () => {
    expect(serverAdvice([down], here, 'qwen3.8-27b')).toEqual({ line: probeLine(down, 'qwen3.8-27b'), models: null, other: null });
  });
});
