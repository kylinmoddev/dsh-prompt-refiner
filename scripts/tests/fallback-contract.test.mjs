/**
 * Behavioural regression test: the fallback contract of the optimize route.
 *
 * The bug this pins down: earlier builds swallowed every LLM failure/empty
 * result/anchor loss into `{ok:true, optimized:<original>}` and the client then
 * applied the "result" as if it were a real rewrite — the button looked like it
 * worked while nothing changed. The route now reports WHY it degraded in
 * `fallback` and the client surfaces it instead of claiming success.
 *
 * Six server-side behaviours are asserted end-to-end against the registered
 * route (not against a helper): an LLM error, an empty stream, a lost 【...】
 * anchor, a dead second candidate in multi-candidate mode, an AbortSignal
 * forwarded on the happy path, and a timed-out call that actually ABORTS the
 * provider stream (a call that is merely ignored still burns quota). One
 * client-side static assertion guards the browser half from silently dropping
 * the `fallback`/`identical` handling again.
 *
 * The timeout case reloads the module with `DSH_PROMPT_REFINER_TIMEOUT_MS=50`
 * (a cache-busting query string forces a fresh evaluation), so the suite stays
 * under a second instead of waiting the production 75s.
 *
 * Usage: node scripts/tests/fallback-contract.test.mjs [module-path]
 * The optional argument points the cases at another artifact (for example
 * `../../lib/index.js`) so the test can be run against the built bundle; the
 * two signal cases require a build that includes the 0.5.2 abort path.
 * Exit code 0 = every case passed, 1 = a case failed.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_SPEC = process.argv[2] ?? '../../src/index.js';
const { apply } = await import(MODULE_SPEC);

const ROUTE = '/dsh-prompt-refiner/optimize';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLIENT_SOURCE = resolve(ROOT, 'client/client.js');

/**
 * Import a FRESH module instance with a tiny timeout budget. The constant is
 * read at module top level, so a cache-busting query string is required after
 * the default instance (75s) has already been evaluated.
 */
async function importWithTimeoutEnv(ms) {
  const previous = process.env.DSH_PROMPT_REFINER_TIMEOUT_MS;
  process.env.DSH_PROMPT_REFINER_TIMEOUT_MS = String(ms);
  try {
    return await import(`${MODULE_SPEC}?timeout=${ms}-${Date.now()}`);
  } finally {
    if (previous === undefined) delete process.env.DSH_PROMPT_REFINER_TIMEOUT_MS;
    else process.env.DSH_PROMPT_REFINER_TIMEOUT_MS = previous;
  }
}

// --------------------------------------------------------------- fake host ---

/**
 * A minimal host: it registers the optimize route and answers each dispatch
 * with the next stub from `streams` (the last one repeats). A stub may throw
 * synchronously — that is exactly how a dead provider surfaces from
 * `ctx.llm.stream` — or return an async chunk generator.
 */
function makeHost(streams) {
  const routes = new Map();
  const calls = [];
  let cursor = 0;
  const ctx = {
    effect(fn) {
      fn();
      return () => {};
    },
    webServer: {
      register({ path, handler }) {
        routes.set(path, handler);
        return () => routes.delete(path);
      },
    },
    sessions: { get: () => undefined },
    llm: {
      async resolveModelInfo() {
        return { provider: 'test', id: 'test' };
      },
      stream(options) {
        calls.push(options);
        const stub = streams[cursor] ?? streams[streams.length - 1];
        cursor += 1;
        if (stub === undefined) throw new Error('test host: no stream stub left');
        return stub(options);
      },
    },
  };
  return { ctx, routes, calls };
}

/** A stream that yields `text` (when non-empty) and then a normal finish. */
function reply(text) {
  return () => (async function* () {
    if (text !== '') yield { type: 'text-delta', text };
    yield { type: 'finish', reason: { kind: 'stop' } };
  })();
}

/** A stream that dies before producing anything. */
function fail(message, code) {
  return () => {
    throw Object.assign(new Error(message), code === undefined ? {} : { code });
  };
}

async function post(routes, body) {
  const handler = routes.get(ROUTE);
  if (handler === undefined) throw new Error(`route ${ROUTE} was never registered`);
  const request = {
    method: 'POST',
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  };
  let status = 0;
  let payload = null;
  const response = {
    writeHead(code) {
      status = code;
    },
    end(text) {
      payload = JSON.parse(text);
    },
  };
  await handler(request, response);
  return { status, payload };
}

// ----------------------------------------------------------------- fixtures ---

/** The draft always carries an anchor the rewrite is not allowed to lose. */
const DRAFT = '请把这段产品说明改写成给新用户看的引导文案，保持【待补充：目标用户】原样。';

/** A faithful rewrite: keeps the anchor, so it passes the intent check. */
const FAITHFUL = '请把这段产品说明改写成给新用户看的引导文案，保持【待补充：目标用户】原样，并在结尾附上三步上手清单。';

/** A rewrite that silently dropped the 【...】 anchor. */
const LOSES_ANCHOR = '请把这段产品说明改写成给新用户看的引导文案，并在结尾附上三步上手清单。';

// -------------------------------------------------------------------- cases ---

const results = [];

async function behavioural(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? '' });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

await behavioural('an LLM error returns 200 with fallback "llm-error" and the original draft', async () => {
  const host = makeHost([fail('provider exploded', 'PROVIDER_DOWN')]);
  apply(host.ctx);
  const { status, payload } = await post(host.routes, { provider: 'test', model: 'test', text: DRAFT });
  expect(status === 200, `expected 200, got ${status} ${JSON.stringify(payload)}`);
  expect(payload?.ok === true, `payload not ok: ${JSON.stringify(payload)}`);
  expect(payload.fallback === 'llm-error', `expected fallback "llm-error", got ${JSON.stringify(payload.fallback)}`);
  expect(payload.optimized === DRAFT, `optimized must be the original draft verbatim, got ${JSON.stringify(payload.optimized)}`);
  expect(host.calls.length === 1, `expected one dispatch, got ${host.calls.length}`);
  return '200 {ok:true, fallback:"llm-error", optimized===draft}';
});

await behavioural('an empty stream returns fallback "empty-result" and the original draft', async () => {
  const host = makeHost([reply('')]);
  apply(host.ctx);
  const { status, payload } = await post(host.routes, { provider: 'test', model: 'test', text: DRAFT });
  expect(status === 200, `expected 200, got ${status} ${JSON.stringify(payload)}`);
  expect(payload?.ok === true, `payload not ok: ${JSON.stringify(payload)}`);
  expect(payload.fallback === 'empty-result', `expected fallback "empty-result", got ${JSON.stringify(payload.fallback)}`);
  expect(payload.optimized === DRAFT, `optimized must be the original draft verbatim, got ${JSON.stringify(payload.optimized)}`);
  return '200 {ok:true, fallback:"empty-result", optimized===draft}';
});

await behavioural('a rewrite that drops a 【...】 anchor returns fallback "intent-check"', async () => {
  const host = makeHost([reply(LOSES_ANCHOR)]);
  apply(host.ctx);
  const { status, payload } = await post(host.routes, { provider: 'test', model: 'test', text: DRAFT });
  expect(status === 200, `expected 200, got ${status} ${JSON.stringify(payload)}`);
  expect(payload?.ok === true, `payload not ok: ${JSON.stringify(payload)}`);
  expect(payload.fallback === 'intent-check', `expected fallback "intent-check", got ${JSON.stringify(payload.fallback)}`);
  expect(payload.optimized === DRAFT, `optimized must be the original draft verbatim, got ${JSON.stringify(payload.optimized)}`);
  return '200 {ok:true, fallback:"intent-check", optimized===draft}';
});

await behavioural('multi-candidate: a dead second candidate still yields {candidates:2} with a non-empty result', async () => {
  const host = makeHost([reply(FAITHFUL), fail('second candidate exploded', 'PROVIDER_DOWN')]);
  apply(host.ctx);
  const { status, payload } = await post(host.routes, { provider: 'test', model: 'test', text: DRAFT, multiCandidate: true });
  expect(status === 200, `expected 200, got ${status} ${JSON.stringify(payload)}`);
  expect(payload?.ok === true, `payload not ok: ${JSON.stringify(payload)}`);
  expect(payload.candidates === 2, `expected candidates:2, got ${JSON.stringify(payload.candidates)}`);
  expect(typeof payload.optimized === 'string' && payload.optimized.trim() !== '', `optimized must be non-empty, got ${JSON.stringify(payload.optimized)}`);
  expect(payload.optimized === FAITHFUL, `candidate A must be kept, got ${JSON.stringify(payload.optimized)}`);
  expect(host.calls.length === 2, `expected two dispatches (A then dead B), got ${host.calls.length}`);
  return '200 {ok:true, candidates:2, optimized===candidate A}';
});

await behavioural('a call that finishes in time forwards a live AbortSignal', async () => {
  const host = makeHost([reply(FAITHFUL)]);
  apply(host.ctx);
  const { status, payload } = await post(host.routes, { provider: 'test', model: 'test', text: DRAFT });
  expect(status === 200, `expected 200, got ${status} ${JSON.stringify(payload)}`);
  expect(payload?.fallback === undefined, `a healthy rewrite must not carry a fallback: ${JSON.stringify(payload)}`);
  const signal = host.calls[0]?.signal;
  expect(signal instanceof AbortSignal, 'ctx.llm.stream received no AbortSignal on the happy path');
  expect(signal.aborted === false, 'signal was already aborted before the call finished');
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(signal.aborted === false, 'signal aborted shortly after a successful call (timer must be cleared, not fired)');
  return 'options.signal is a live AbortSignal, never aborted';
});

await behavioural('a timed-out call actually aborts the provider stream signal', async () => {
  const started = Date.now();
  const fresh = await importWithTimeoutEnv(50);
  let streamSignal = null;
  let resolveAbort;
  const abortObserved = new Promise((resolve) => {
    resolveAbort = resolve;
  });
  // A provider that accepts the call and then never yields anything. Only a
  // real abort (not just "stop waiting") can stop it consuming quota.
  const hanging = (options) => {
    streamSignal = options.signal;
    expect(streamSignal instanceof AbortSignal, 'timeout case: ctx.llm.stream received no AbortSignal');
    if (streamSignal.aborted) resolveAbort(true);
    else streamSignal.addEventListener('abort', () => resolveAbort(true), { once: true });
    return (async function* () {
      await new Promise(() => {});
    })();
  };
  const host = makeHost([hanging]);
  fresh.apply(host.ctx);
  const { status, payload } = await post(host.routes, { provider: 'test', model: 'test', text: DRAFT });
  expect(status === 200, `expected 200, got ${status} ${JSON.stringify(payload)}`);
  expect(payload?.ok === true, `payload not ok: ${JSON.stringify(payload)}`);
  expect(payload.fallback === 'llm-error', `expected fallback "llm-error", got ${JSON.stringify(payload.fallback)}`);
  expect(payload.optimized === DRAFT, `optimized must be the original draft verbatim, got ${JSON.stringify(payload.optimized)}`);
  const aborted = await Promise.race([
    abortObserved,
    new Promise((resolve) => setTimeout(() => resolve(false), 1000)),
  ]);
  expect(aborted === true, 'the provider signal was never aborted — the timed-out call was ignored, not cancelled');
  expect(streamSignal.aborted === true, 'signal.aborted is still false after the timeout');
  const elapsed = Date.now() - started;
  expect(elapsed < 5000, `test took ${elapsed}ms — the per-test timeout budget was not overridden`);
  return `200 + original + llm-error; provider signal aborted after ~50ms (case ${elapsed}ms)`;
});

await behavioural('client timeout budget is generous and mode-aware', async () => {
  const clientText = readFileSync(CLIENT_SOURCE, 'utf8');
  const read = (name) => {
    const m = clientText.match(new RegExp('var ' + name + '\\s*=\\s*(\\d+)'));
    return m === null ? null : Number(m[1]);
  };
  const single = read('REQUEST_TIMEOUT_MS');
  const multi = read('MULTI_CANDIDATE_TIMEOUT_MS');
  const slow = read('SLOW_REQUEST_NOTICE_MS');
  expect(single !== null && single >= 120000, `single-candidate timeout is ${single}ms — too tight for long drafts (was 90000)`);
  expect(multi !== null && multi >= 240000, `multi-candidate timeout is ${multi}ms — two rewrites + a judge need far more than the single budget`);
  expect(multi > single, 'the multi-candidate budget must exceed the single-candidate budget');
  expect(slow !== null && slow <= single, `the slow notice (${slow}ms) must fire before the hard ceiling (${single}ms)`);
  return `single ${single}ms, multi ${multi}ms, notice ${slow}ms (notice only, no abort)`;
});

await behavioural('a client disconnect cancels the provider call (code CLIENT_CLOSED)', async () => {
  const fresh = await importWithTimeoutEnv(75000);
  let streamSignal = null;
  let resolveStarted;
  const startedCall = new Promise((resolve) => {
    resolveStarted = resolve;
  });
  let resolveAbort;
  const abortObserved = new Promise((resolve) => {
    resolveAbort = resolve;
  });
  const hanging = (options) => {
    streamSignal = options.signal;
    if (streamSignal.aborted) resolveAbort(true);
    else streamSignal.addEventListener('abort', () => resolveAbort(true), { once: true });
    resolveStarted(true);
    return (async function* () {
      await new Promise(() => {});
    })();
  };
  const host = makeHost([hanging]);
  fresh.apply(host.ctx);

  const listeners = new Map();
  const request = {
    method: 'POST',
    headers: {},
    on(event, fn) {
      listeners.set(event, fn);
    },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ provider: 'test', model: 'test', text: DRAFT }));
    },
  };
  let status = 0;
  let payload = null;
  const response = {
    writeHead(code) {
      status = code;
    },
    end(text) {
      payload = JSON.parse(text);
    },
  };
  const handlerDone = host.routes.get(ROUTE)(request, response);

  await Promise.race([startedCall, new Promise((resolve) => setTimeout(() => resolve(false), 1000))]);
  expect(streamSignal !== null, 'the provider was never called');
  const close = listeners.get('close');
  expect(typeof close === 'function', 'the handler never subscribed to the request close event');
  close();

  const aborted = await Promise.race([
    abortObserved,
    new Promise((resolve) => setTimeout(() => resolve(false), 1000)),
  ]);
  expect(aborted === true, 'closing the request did not abort the provider signal — the call keeps burning quota');
  await Promise.race([handlerDone, new Promise((resolve) => setTimeout(() => resolve(false), 1000))]);
  expect(payload?.fallback === 'llm-error', `expected the llm-error fallback, got ${JSON.stringify(payload)}`);
  return `close event aborted the provider signal within 1s; response ${status} + fallback llm-error`;
});

await behavioural('client still consumes data.fallback and has an identical-result check', async () => {
  const clientText = readFileSync(CLIENT_SOURCE, 'utf8');
  const readsFallback =
    /data\s*&&\s*typeof\s+data\.fallback/.test(clientText) || /\bdata\.fallback\b/.test(clientText);
  expect(readsFallback, 'client/client.js no longer reads data.fallback — a degraded result would be shown as success again');
  expect(/\bidentical\b/.test(clientText), 'client/client.js no longer has an identical-result check');
  expect(
    /optimized\.trim\(\)\s*===\s*text/.test(clientText),
    'the identical-result check no longer compares the optimized text with the draft',
  );
  return 'data.fallback consumed; identical check compares optimized vs draft';
});

await behavioural('client freshness guards read the live draft, not the click-time snapshot', async () => {
  const clientText = readFileSync(CLIENT_SOURCE, 'utf8');
  // Regression: `input` is a React snapshot. Reading it inside the async
  // response handler compares the OLD draft with itself, so edits typed while
  // the request was in flight were silently overwritten (found by browser E2E
  // on 0.5.3). Guards must go through liveComposerDraft().
  expect(
    /function liveComposerDraft\(/.test(clientText),
    'client/client.js no longer defines liveComposerDraft() — the stale-closure guard regressed',
  );
  expect(
    /normalizeDraft\(liveComposerDraft\(input\)\)/.test(clientText),
    'the in-flight draft guard no longer normalizes a live composer read',
  );
  expect(
    !/fresh\s*=\s*getComposerDraft\(input\)/.test(clientText),
    'a freshness guard still calls getComposerDraft(input) — that is the click-time snapshot and can never detect a change',
  );
  return 'guards use liveComposerDraft(); no guard reads the stale input snapshot';
});

// ------------------------------------------------------------------- report ---

let failures = 0;
for (const result of results) {
  if (!result.ok) failures += 1;
  const mark = result.ok ? 'PASS' : 'FAIL';
  const detail = result.detail === '' ? '' : ` — ${result.detail}`;
  console.log(`[${mark}] ${result.name}${detail}`);
}
console.log(`\n[fallback-contract] ${results.length - failures}/${results.length} passed`);
if (failures > 0) {
  console.error(`[fallback-contract] FAILED: ${failures} case(s)`);
  process.exit(1);
}
console.log('[fallback-contract] OK');
