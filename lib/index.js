/**
 * dsh-prompt-refiner (v2) — server half.
 *
 * Exposes a small trusted-local HTTP route that calls the user's currently
 * selected model (provider/model are sent from the browser client) and returns
 * an optimized prompt. The client places the result back into the composer.
 *
 * Origin policy: the desktop shell serves its UI from the `dsh-app://app`
 * scheme and its protocol proxy strips the Origin header, so a missing Origin is
 * the normal desktop case. Browsers on `dsh web` do send an origin, which must
 * match this server's host. The earlier strict check refused every desktop
 * request with 403 "Cross-origin requests are not allowed".
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const name = 'dsh-prompt-refiner';

export const inject = ['webServer', 'llm', 'sessions'];

const ROUTE_PATH = '/dsh-prompt-refiner/optimize';
const ROUTE_PING = '/dsh-prompt-refiner/ping';

/** The desktop window's own origin; the shell's protocol proxy strips Origin, but browsers may not. */
const DESKTOP_ORIGIN = 'dsh-app://app';

/** Version reported by the diagnostic ping route; read from the package manifest. */
function readPluginVersion() {
  try {
    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    return JSON.parse(manifest).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const PLUGIN_VERSION = readPluginVersion();
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB is enough for long drafts.
const OPTIMIZER_TEMPERATURE = 0.4; // stable, focused rewrites without being too rigid
const CONTEXT_MESSAGE_LIMIT = 6; // recent messages used when "结合上下文" is enabled
const CONTEXT_CHAR_LIMIT = 8000; // rule-based trimming kicks in above this total length
const MULTI_CANDIDATE_SERVER = true; // server-side master switch for multi-candidate selection
const OPTIMIZE_TIMEOUT_MS = Number.parseInt(process.env.DSH_PROMPT_REFINER_TIMEOUT_MS ?? '', 10) || 75000; // hard ceiling for one LLM call; production default 75000, env override for tests

/* ------------------------------------------------------------------ *
 * Diagnostics (fork-local patch)
 *
 * Upstream swallowed every failure into `{ok:true, optimized:<original>}`
 * without emitting a single log line, so a no-op rewrite was
 * indistinguishable from a real one. These helpers give the server half a
 * trace; the browser devtools console shows the client half.
 * ------------------------------------------------------------------ */
const LOG_PREFIX = '[dsh-prompt-refiner]';

function logInfo(message, detail) {
  try {
    console.info(LOG_PREFIX, message, detail === undefined ? '' : detail);
  } catch {
    // logging must never break the request
  }
}

function logWarn(message, detail) {
  try {
    console.warn(LOG_PREFIX, message, detail === undefined ? '' : detail);
  } catch {
    // ignore
  }
}

function logError(message, detail) {
  try {
    console.error(LOG_PREFIX, message, detail === undefined ? '' : detail);
  } catch {
    // ignore
  }
}


const OPTIMIZER_SYSTEM_PROMPT = `You are a prompt editor, not a prompt author. The user gives you a draft prompt. Rewrite it so it is unambiguous and ready to paste, while staying as close to the draft as possible.

Silently identify: the task, the inputs the user already provides, the constraints the user already stated, and anything genuinely ambiguous. Do not output this analysis.

Rules for the rewritten prompt:
- Output only the rewritten prompt. No commentary, no preface, no code fence around the whole answer; code fences inside the prompt are fine when the prompt itself needs them.
- Keep the user's language, tone and wording wherever it already works. Do not turn the draft into a template.
- Do not add tasks, sections, roles, audiences, deliverables or acceptance criteria that the draft does not already imply. If the draft asks for one thing, the rewrite asks for one thing.
- Keep every {{variable}}, 【...】 marker, URL, number, file path and proper name exactly as written; never rename, fill in, or drop them.
- Never leave 【placeholder】 in the output. When something is missing, choose the most reasonable assumption and state it in one short line at the very end, prefixed 【假设】. More than three such assumptions means the draft was too underspecified to guess - then keep the assumptions minimal and say so once.
- Length budget: a short draft stays short (at most about 1.5x its length); a long draft may not grow by more than 30%. Adding structure is not a goal by itself.
- If the draft is already clear, make only the minimum edit that removes ambiguity.
- Do not invent facts, numbers, constraints, audiences or context.
- If the draft is not really a prompt (a bare question or greeting), turn it into the prompt the user evidently needs, using their words.

The output must read like the user's own prompt, only clearer - never like a form to be filled in.
`;

const STYLE_INSTRUCTIONS = {
  concise: `
Optimization style: concise.
- Stay as short as the draft: remove filler and fix ambiguity, add nothing.
- Keep the draft's own order and wording where it already works.
`,
  standard: `
Optimization style: standard.
- Same as concise, plus a short numbered list ONLY when the draft already carries several requirements.
- No role cards, no added sections, no invented acceptance criteria.
`,
  detailed: `
Optimization style: detailed.
- Stay inside the draft's scope: spell out the details the draft already implies (inputs, steps, output shape), in place.
- No role card, no gap list, no 【placeholder】 marks; at most one trailing 【假设】 line.
- Longer than the draft is acceptable only when it removes real ambiguity, and never beyond the length budget.
`,
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

/**
 * Accept requests that come from this server's own UI.
 *
 * A missing Origin is the normal desktop case: the Electron shell loads the UI
 * over `dsh-app://app` and its protocol proxy drops the header. An explicit
 * `dsh-app://app` origin is also accepted for shells that forward it. Anything
 * else must be a real same-origin browser request, so a hostile page still
 * cannot drive this route.
 */
function originAllowed(request) {
  const origin = request.headers.origin;
  if (origin === undefined || origin === null || origin === '') return true;
  if (origin === DESKTOP_ORIGIN) return true;
  const host = request.headers.host;
  if (typeof host !== 'string' || host === '') return false;
  try {
    return new URL(String(origin)).host === host;
  } catch {
    return false;
  }
}

/** Read a size-capped JSON request body. */
async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      const error = new Error('request body too large');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Consume an LLM chunk stream and return the assembled visible text.
 * We deliberately ignore reasoning deltas and tool calls: the optimizer is a
 * plain text-to-text call.
 */
async function collectText(stream) {
  let text = '';
  let failure = null;
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') {
      text += chunk.text;
    } else if (chunk.type === 'finish') {
      const reason = chunk.reason;
      if (reason?.kind === 'error' || reason?.kind === 'aborted') {
        failure = reason.failure ?? new Error(reason.kind);
      }
    }
  }
  if (failure !== null) throw failure;
  return text.trim();
}

/**
 * Run one LLM call with a hard deadline and a real cancellation path.
 *
 * `run` receives an AbortSignal that is wired into `ctx.llm.stream`, so a
 * timed-out call stops consuming provider quota instead of merely being
 * ignored (0.5.2's version only stopped waiting). The timer is always cleared,
 * a call that finished in time is never aborted, and a rejection that arrives
 * after the race has already been decided is swallowed so it cannot surface as
 * unhandledRejection.
 *
 * `externalSignal` (optional) comes from the HTTP request: when the browser
 * disconnects, the handler aborts it and the LLM call is cancelled too, so an
 * abandoned request stops burning provider quota.
 */
function withTimeout(run, ms, code, externalSignal) {
  const controller = new AbortController();
  let timer;
  let rejectGuard;
  const guard = new Promise((_, reject) => {
    rejectGuard = reject;
  });
  const fail = (error) => {
    if (!controller.signal.aborted) controller.abort();
    rejectGuard(error);
  };
  timer = setTimeout(() => {
    fail(Object.assign(new Error('optimize timed out'), { code }));
  }, ms);
  // The HTTP handler aborts this when the browser goes away: without it the
  // server kept generating a result nobody would ever receive.
  const onExternalAbort = () => {
    fail(Object.assign(new Error('client closed the request'), { code: 'CLIENT_CLOSED' }));
  };
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const attempt = (async () => run(controller.signal))();
  attempt.catch(() => {}); // late rejection after the timeout won the race
  return Promise.race([attempt, guard]).finally(() => {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  });
}

function errorPayload(error) {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = String(error.message);
    const code = typeof error.code === 'string' ? error.code : 'LLM_ERROR';
    return { ok: false, error: { code, message } };
  }
  return { ok: false, error: { code: 'LLM_ERROR', message: String(error) } };
}

function errorCode(error) {
  return typeof error === 'object' && error !== null && typeof error.code === 'string' ? error.code : '';
}

/**
 * Extract the code-level intent anchors a rewrite must never lose:
 * {{variable}} placeholders, 【...】 marks already in the draft, and URLs.
 */
function extractIntentItems(text) {
  const items = [];
  for (const match of text.matchAll(/\{\{[^{}]*\}\}/g)) items.push(match[0]);
  for (const match of text.matchAll(/【[^【】]*】/g)) items.push(match[0]);
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'）)]+/g)) items.push(match[0]);
  return [...new Set(items)];
}

/**
 * Code-level intent-preservation check (never trust the model's own
 * self-check alone: failure or doubt means NOT passed). Returns the list of
 * anchors missing from the optimized text.
 */
function missingIntentItems(original, optimized) {
  // Compare after unicode/whitespace normalization: the model routinely
  // rewrites full-width punctuation to half-width (or collapses spaces)
  // without losing meaning, and a strict substring test turned those
  // harmless edits into a full revert to the original draft.
  const haystack = normalizeAnchor(optimized);
  return extractIntentItems(original).filter((item) => !haystack.includes(normalizeAnchor(item)));
}

function normalizeAnchor(text) {
  return String(text)
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
}

/**
 * Turn a raw LLM result into the response payload. Failure or doubt is never
 * silently passed off as success — the reason lands in `fallback`.
 */
function finalizeOptimized(original, optimized) {
  if (typeof optimized !== 'string' || optimized.trim() === '') {
    return { optimized: original, fallback: 'empty-result' };
  }
  if (missingIntentItems(original, optimized).length > 0) {
    return { optimized: original, fallback: 'intent-check' };
  }
  return { optimized };
}

/**
 * Reconcile a requested reasoning effort with the capabilities the selected
 * model actually advertises.
 *
 * The harness validates an explicit effort strictly and rejects it rather than
 * clamping it (see `resolveCallWithInfo` in dsh-llm: "no clamping or aliasing is
 * performed"). The browser client forwards the effort saved on the session, and
 * that value outlives a model switch: pick a custom route that publishes no
 * reasoning metadata while the session still carries `reasoningEffort: "high"`,
 * and every request dies with UNSUPPORTED_REASONING_EFFORT. Choosing a model
 * must never disable the optimizer, so an effort the model cannot honor is
 * dropped here — the model then runs on its own default.
 *
 * @param modelInfo - the harness's exact model metadata for this route.
 * @param requested - the effort the caller asked for, if any.
 * @returns the effort to send, or undefined to use the model's own default.
 */
function reconcileReasoningEffort(modelInfo, requested) {
  if (typeof requested !== 'string' || requested === '') return undefined;
  const efforts = modelInfo?.reasoning?.efforts;
  if (!Array.isArray(efforts)) return undefined;
  return efforts.some((effort) => effort?.id === requested) ? requested : undefined;
}

/**
 * Ask the harness what the selected model supports before spending a call.
 * A capability lookup that fails must not fail the request: fall back to no
 * explicit effort, which every model accepts.
 */
async function acceptedReasoningEffort(ctx, provider, model, requested) {
  if (typeof requested !== 'string' || requested === '') return undefined;
  try {
    return reconcileReasoningEffort(await ctx.llm.resolveModelInfo(provider, model), requested);
  } catch {
    return undefined;
  }
}

function messageText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ');
}

/**
 * Hard-truncate a text keeping both ends: head…tail with an ellipsis marker.
 */
function hardTruncate(text, budget) {
  if (text.length <= budget) return text;
  if (budget <= 20) return text.slice(0, budget);
  const head = Math.ceil((budget - 1) / 2);
  const tail = Math.floor((budget - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/**
 * Sentence-level trim of one context message: keep the first and last
 * sentences (they carry the framing and the conclusion), then hard-truncate
 * whatever still overshoots the budget. Idea borrowed from LLMLingua's
 * sentence-level budget pass (prompt_compressor.py:1243), minus the model.
 */
function compressContextMessage(text, budget) {
  if (text.length <= budget) return text;
  const sentences = text.split(/(?<=[。.!！?？;\n])/).filter((part) => part.trim() !== '');
  const first = sentences[0] ?? '';
  const last = sentences.length > 1 ? sentences[sentences.length - 1] : '';
  let kept = sentences.length > 1 ? first + last : first;
  if (kept.length > budget) kept = hardTruncate(kept, budget);
  return kept;
}

function buildRecentContext(session, limit = CONTEXT_MESSAGE_LIMIT) {
  if (!session || typeof session.deriveMessages !== 'function') return '';
  const messages = session.deriveMessages();
  const recent = messages.slice(-limit).filter((message) => messageText(message).trim() !== '');
  if (recent.length === 0) return '';
  const parts = recent.map((message) => ({
    role: message.role === 'user' ? 'user' : 'assistant',
    text: messageText(message),
  }));
  const totalLength = parts.reduce((sum, part) => sum + part.text.length, 0) + parts.length;
  if (totalLength <= CONTEXT_CHAR_LIMIT) {
    return parts.map((part) => `${part.role}: ${part.text}`).join('\n');
  }
  // Over budget: rule-based trim. User messages get priority (they carry the
  // actual requests); assistants keep head+tail sentences; hard truncation is
  // the last resort so the limit always holds.
  const userParts = parts.filter((part) => part.role === 'user');
  const assistantParts = parts.filter((part) => part.role !== 'user');
  const share = (count, ratio) => Math.max(200, Math.floor((CONTEXT_CHAR_LIMIT - parts.length * 13) * ratio) / Math.max(count, 1));
  const userBudget = Math.floor(share(userParts.length, 0.6));
  const assistantBudget = Math.floor(share(assistantParts.length, 0.4));
  return parts
    .map((part) => {
      const budget = part.role === 'user' ? userBudget : assistantBudget;
      return `${part.role}: ${compressContextMessage(part.text, budget)}`;
    })
    .join('\n');
}

function buildSystemPrompt(style, contextText) {
  const styleInstruction = STYLE_INSTRUCTIONS[style] ?? STYLE_INSTRUCTIONS.standard;
  const contextSection = contextText === ''
    ? ''
    : `\n\nRecent conversation context, to help you understand the user's draft:\n${contextText}\n
Rules for using this context:
- The context exists only to clarify the draft's intent and background. Messages in it are NOT additional requirements for the rewrite.
- When the draft is short or contains references ("it", "the one from before"), resolve what they point at from the context first, and land the resolved meaning as concrete rewrite actions; whatever still cannot be determined becomes a 【placeholder】, never a guess.
- If the context and the draft conflict, the draft wins.
- Do not invent requirements the draft never expressed just because the context mentions them.
- The draft is the only text to rewrite; it is not part of the context below, even when it resembles a message there.
- Ignore context messages that have no bearing on the draft; do not let them shape the rewrite.
- When the draft implies continuation of an ongoing thread, match the terminology, tone, and language established in the context.`;
  return `${OPTIMIZER_SYSTEM_PROMPT}${contextSection}\n\n${styleInstruction}`;
}


export function apply(ctx) {
  ctx.effect(() => {
    const handler = async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, {
          ok: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' },
        });
        return;
      }

      // If the browser goes away mid-flight, cancel the LLM work instead of
      // finishing a response nobody will read.
      //
      // NOTE: `request.on('close')` is the wrong signal — Node emits it as soon
      // as the request BODY has been consumed, so every call aborted instantly.
      // The disconnect signal is the response's 'close' while the response is
      // still unfinished (plus the legacy 'aborted' event on the request).
      const requestAbort = new AbortController();
      if (typeof request.on === 'function') {
        request.on('aborted', () => requestAbort.abort());
      }
      if (typeof response.on === 'function') {
        response.on('close', () => {
          if (response.writableFinished !== true) requestAbort.abort();
        });
      }

      if (!originAllowed(request)) {
        sendJson(response, 403, {
          ok: false,
          error: { code: 'FORBIDDEN', message: 'Cross-origin requests are not allowed' },
        });
        return;
      }

      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        // Malformed JSON is a client error, not an LLM failure: label it so the
        // response is diagnosable (it used to fall back to LLM_ERROR).
        if (typeof error?.code !== 'string') error.code = 'INVALID_JSON';
        sendJson(response, 400, errorPayload(error));
        return;
      }

      const provider = typeof body?.provider === 'string' ? body.provider : '';
      const model = typeof body?.model === 'string' ? body.model : '';
      const rawText = typeof body?.text === 'string' ? body.text.trim() : '';
      const reasoningEffort = typeof body?.reasoningEffort === 'string' ? body.reasoningEffort : undefined;
      const style = typeof body?.style === 'string' ? body.style : 'standard';
      const includeContext = body?.includeContext === true;
      const multiCandidate = body?.multiCandidate === true;
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined;

      if (provider === '' || model === '' || rawText === '') {
        sendJson(response, 400, {
          ok: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'provider, model and non-empty text are required',
          },
        });
        return;
      }

      let contextText = '';
      if (includeContext && sessionId !== undefined) {
        const session = ctx.sessions.get(sessionId);
        contextText = buildRecentContext(session);
      }


      const messages = [{
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: rawText }],
        source: { kind: 'plugin', plugin: name },
      }];

      const system = buildSystemPrompt(style, contextText);
      logInfo('optimize request', {
        provider,
        model,
        style,
        includeContext,
        multiCandidate,
        chars: rawText.length,
        hasContext: contextText !== '',
      });

      /** One raw dispatch; `effort` undefined means "let the model decide". */
      const dispatch = async (effort) => {
        const options = {
          provider,
          model,
          messages,
          system,
          temperature: OPTIMIZER_TEMPERATURE,
        };
        if (effort !== undefined) options.reasoningEffort = effort;
        return withTimeout(
          (signal) => collectText(ctx.llm.stream({ ...options, signal })),
          OPTIMIZE_TIMEOUT_MS,
          'LLM_TIMEOUT',
          requestAbort.signal,
        );
      };

      /** One candidate with the UNSUPPORTED_REASONING_EFFORT safety net. */
      const generateCandidate = async (effort) => {
        try {
          return await dispatch(effort);
        } catch (error) {
          if (effort === undefined || errorCode(error) !== 'UNSUPPORTED_REASONING_EFFORT') throw error;
          return dispatch(undefined);
        }
      };

      /**
       * One LLM pass picking the better candidate. Returns 'A', 'B', or null
       * when the verdict is missing or unparseable (the caller then keeps
       * candidate A — an undecidable verdict must not invent a winner).
       */
      const JUDGE_FOCUS = {
        concise: 'the more concise candidate that still preserves every key constraint and acceptance criterion',
        standard: 'the more balanced and directly executable candidate',
        detailed: 'the more comprehensive and self-contained candidate',
      };
      const judgeCandidates = async (candidateA, candidateB) => {
        const focus = JUDGE_FOCUS[style] ?? JUDGE_FOCUS.standard;
        const judgeSystem = 'You are a strict prompt-quality judge. Compare two optimized versions of the same draft prompt. Reply with ONLY a JSON object: {"winner":"A"} or {"winner":"B"}. No other text.';
        const judgeText = `Original draft:\n<original>\n${rawText}\n</original>\n\nCandidate A:\n<candidate>\n${candidateA}\n</candidate>\n\nCandidate B:\n<candidate>\n${candidateB}\n</candidate>\n\nEvaluation focus for this optimization style: pick ${focus}. Also penalize any candidate that lost {{variable}} placeholders, 【...】 marks, or URLs from the original. Output the JSON verdict only.`;
        const verdict = await withTimeout(
          (signal) => collectText(ctx.llm.stream({
            provider,
            model,
            messages: [{
              id: randomUUID(),
              role: 'user',
              content: [{ type: 'text', text: judgeText }],
              source: { kind: 'plugin', plugin: name },
            }],
            system: judgeSystem,
            temperature: 0,
            signal,
          })),
          OPTIMIZE_TIMEOUT_MS,
          'LLM_TIMEOUT',
          requestAbort.signal,
        );
        const match = verdict.match(/\{\s*"winner"\s*:\s*"(A|B)"\s*\}/);
        return match === null ? null : match[1];
      };

      try {
        const effort = await acceptedReasoningEffort(ctx, provider, model, reasoningEffort);
        if (multiCandidate && MULTI_CANDIDATE_SERVER) {
          const candidateA = await generateCandidate(effort);
          let candidateB = '';
          try {
            candidateB = await generateCandidate(effort);
          } catch (error) {
            // One dead candidate must not kill the whole request: keep A.
            logWarn('multi-candidate: second candidate failed', {
              code: errorCode(error) || null,
              message: error?.message ?? String(error),
            });
          }
          const usableA = candidateA !== '';
          const usableB = candidateB !== '';
          if (!usableA && !usableB) {
            logWarn('multi-candidate: both candidates empty');
            throw new Error('the model returned an empty candidate');
          }
          let winnerLetter = 'A';
          if (usableA && usableB) {
            try {
              winnerLetter = (await judgeCandidates(candidateA, candidateB)) ?? 'A';
            } catch (error) {
              logWarn('multi-candidate: judge failed, keeping candidate A', {
                message: error?.message ?? String(error),
              });
              winnerLetter = 'A'; // judge failed → keep candidate A, never fail the request
            }
          } else {
            winnerLetter = usableA ? 'A' : 'B';
            logWarn('multi-candidate: degrading to the only usable candidate', {
              kept: winnerLetter,
            });
          }
          const winner = winnerLetter === 'B' ? candidateB : candidateA;
          const finalized = finalizeOptimized(rawText, winner);
          if (finalized.fallback !== undefined) {
            logWarn('optimize degraded to the original draft', {
              reason: finalized.fallback,
              style,
              multiCandidate: true,
            });
          }
          sendJson(response, 200, { ok: true, optimized: finalized.optimized, fallback: finalized.fallback, candidates: 2 });
          return;
        }
        let optimized;
        try {
          optimized = await generateCandidate(effort);
        } catch (error) {
          // Safety net for a capability lookup that could not see the truth (an
          // adapter raced by HMR, or a route registered after the catalog load):
          // retry once with no explicit effort instead of failing the feature.
          if (effort === undefined || errorCode(error) !== 'UNSUPPORTED_REASONING_EFFORT') throw error;
          optimized = await generateCandidate(undefined);
        }
        const finalized = finalizeOptimized(rawText, optimized);
        if (finalized.fallback !== undefined) {
          logWarn('optimize degraded to the original draft', {
            reason: finalized.fallback,
            style,
            chars: rawText.length,
          });
        }
        // Legacy path: byte-identical success payload when nothing fell back.
        if (finalized.fallback === undefined) {
          sendJson(response, 200, { ok: true, optimized: finalized.optimized });
        } else {
          sendJson(response, 200, { ok: true, optimized: finalized.optimized, fallback: finalized.fallback });
        }
      } catch (error) {
        // Failure fallback contract: LLM error/timeout/empty must not fail the
        // feature — return the original draft with the reason in `fallback`.
        // The client now surfaces that reason instead of claiming success.
        logError('optimize failed; returning the original draft', {
          provider,
          model,
          style,
          multiCandidate,
          code: errorCode(error) || null,
          message: String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 200),
        });
        sendJson(response, 200, { ok: true, optimized: rawText, fallback: 'llm-error' });
      }
    };

    /** Diagnostic route: proves which build the host actually loaded. */
    const pingHandler = (request, response) => {
      if (request.method !== 'GET') {
        sendJson(response, 405, {
          ok: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET' },
        });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        plugin: name,
        version: PLUGIN_VERSION,
        revision: 'v2-origin-fix',
      });
    };

    const unregisterOptimize = ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler,
    });
    const unregisterPing = ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PING,
      handler: pingHandler,
    });
    return () => {
      unregisterOptimize();
      unregisterPing();
    };
  }, 'dsh-prompt-refiner: optimize route');
}
