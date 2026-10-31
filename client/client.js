window.__ModuleLoader__.load({ id: "@kylinmoddev/dsh-prompt-refiner", factory: (require) => {
  var module = { exports: {} };
  var exports = module.exports;
  var React = require("react");
  var ReactDOM = require("react-dom");

  var PACKAGE_ID = "@kylinmoddev/dsh-prompt-refiner";
  var ENDPOINT = "/dsh-prompt-refiner/optimize";
  var PING_ENDPOINT = "/dsh-prompt-refiner/ping";
  var STYLE_ID = "dsh-prompt-refiner-styles";
  var SETTINGS_KEY = "dsh-prompt-refiner:settings";

  var DEFAULT_SETTINGS = {
    style: "standard",
    includeContext: false,
    multiCandidate: false,
    applyMode: "direct", // "direct" | "preview"
  };

  var STYLE_OPTIONS = ["concise", "standard", "detailed"];
  var APPLY_OPTIONS = ["direct", "preview"];
  var TOAST_MS = 3500;
  var REQUEST_TIMEOUT_MS = 90000;
  var LOG_PREFIX = "[dsh-prompt-refiner]";

  /* ------------------------------------------------------------------ *
   * Diagnostics (fork-local patch)
   *
   * Upstream shipped zero logging, so a silent no-op left no trace: the
   * request succeeded, `optimized` carried the original text, and the UI
   * still claimed "applied". Everything below makes that diagnosable:
   *
   *   console:  [dsh-prompt-refiner] <event> <detail>
   *   memory:   window.__dshPromptRefinerDebug.events  (last 50 events)
   * ------------------------------------------------------------------ */
  var debugState = {
    plugin: PACKAGE_ID,
    version: "unknown",
    events: [],
    lastRequest: null,
    lastResponse: null,
  };
  try {
    window.__dshPromptRefinerDebug = debugState;
  } catch (_) {
    // non-browser environment; diagnostics are optional
  }

  function pushDebug(kind, detail) {
    var event = { at: new Date().toISOString(), kind: kind, detail: detail || null };
    try {
      debugState.events.push(event);
      if (debugState.events.length > 50) debugState.events.shift();
      debugState.lastEvent = event;
    } catch (_) {
      // ignore
    }
  }

  function logInfo(message, detail) {
    pushDebug(message, detail);
    try {
      console.info(LOG_PREFIX, message, detail === undefined ? "" : detail);
    } catch (_) {
      // ignore
    }
  }

  function logWarn(message, detail) {
    pushDebug(message, detail);
    try {
      console.warn(LOG_PREFIX, message, detail === undefined ? "" : detail);
    } catch (_) {
      // ignore
    }
  }

  /**
   * Resolve the running plugin version from the host, never from a literal
   * in this file: a hard-coded version drifted from the manifest every
   * release. Failure is non-fatal and leaves the state at "unknown".
   */
  function resolvePluginVersion() {
    try {
      if (typeof fetch !== "function") return;
      fetch(PING_ENDPOINT, { method: "GET" })
        .then(function (response) { return response.json(); })
        .then(function (data) {
          if (data && typeof data.version === "string" && data.version) {
            debugState.version = data.version;
            logInfo("plugin version resolved", { version: data.version });
          } else {
            logWarn("plugin version missing from ping response");
          }
        })
        .catch(function (error) {
          logWarn("plugin version probe failed", {
            message: String(error && error.message ? error.message : error),
          });
        });
    } catch (_) {
      // diagnostics stay best-effort; version keeps its "unknown" default
    }
  }

  var cssText = `
/* ---- compact toolbar group (main icon + caret) ---- */
.dsh-prompt-refiner {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin: 0 3px;
  position: relative;
}
.dsh-prompt-refiner__main,
.dsh-prompt-refiner__caret {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 14%));
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-secondary, #444);
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.dsh-prompt-refiner__main {
  width: 30px;
  padding: 0;
  border-radius: 14px 0 0 14px;
}
.dsh-prompt-refiner__caret {
  width: 24px;
  padding: 0;
  border-left: none;
  border-radius: 0 14px 14px 0;
}
.dsh-prompt-refiner__main:hover:not(:disabled),
.dsh-prompt-refiner__caret:hover:not(:disabled) {
  border-color: var(--dsw-alias-brand-primary, #4f6ef7);
  background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%));
  color: var(--dsw-alias-label-primary, #111);
}
.dsh-prompt-refiner__caret:disabled {
  border-left: none;
}
.dsh-prompt-refiner__main:disabled {
  opacity: 0.45;
  cursor: default;
}
.dsh-prompt-refiner__caret:disabled {
  opacity: 0.45;
  cursor: default;
}
.dsh-prompt-refiner__caret[aria-expanded="true"] .dsh-prompt-refiner__caretIcon {
  transform: rotate(180deg);
}
.dsh-prompt-refiner__caretIcon {
  display: inline-flex;
  transition: transform 120ms ease;
}
.dsh-prompt-refiner__dot {
  position: absolute;
  top: 5px;
  right: 3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary, #4f6ef7);
  pointer-events: none;
}
.dsh-prompt-refiner__main[data-busy="true"] {
  cursor: progress;
}
.dsh-prompt-refiner__spinner {
  box-sizing: border-box;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-top-color: transparent;
  animation: dsh-po-spin 700ms linear infinite;
}
@keyframes dsh-po-spin {
  to { transform: rotate(360deg); }
}

/* ---- popover (settings) ---- */
.dsh-prompt-refiner__popover {
  box-sizing: border-box;
  position: fixed;
  z-index: 9990;
  width: min(340px, calc(100vw - 24px));
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 14%));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, #fff);
  color: var(--dsw-alias-label-primary, #111);
  box-shadow: 0 12px 40px rgb(0 0 0 / 22%);
  font-size: 12px;
  line-height: 18px;
}
.dsh-prompt-refiner__popoverTitle {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #444);
}
.dsh-prompt-refiner__popoverRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  flex-wrap: wrap;
}
.dsh-prompt-refiner__popoverField {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.dsh-prompt-refiner__popoverFieldTitle {
  color: var(--dsw-alias-label-primary, #111);
}
.dsh-prompt-refiner__popoverFieldHint {
  color: var(--dsw-alias-label-tertiary, #777);
  font-size: 11px;
  line-height: 16px;
}
.dsh-prompt-refiner__seg {
  display: inline-flex;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 14%));
  border-radius: 8px;
  overflow: hidden;
  flex: none;
}
.dsh-prompt-refiner__seg button {
  box-sizing: border-box;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #444);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  padding: 3px 10px;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.dsh-prompt-refiner__seg button + button {
  border-left: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 14%));
}
.dsh-prompt-refiner__seg button:hover:not([aria-pressed="true"]) {
  background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%));
  color: var(--dsw-alias-label-primary, #111);
}
.dsh-prompt-refiner__seg button[aria-pressed="true"] {
  background: var(--dsw-alias-brand-primary, #4f6ef7);
  color: #fff;
}
.dsh-prompt-refiner__switch {
  display: inline-flex;
  align-items: center;
  flex: none;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
}
.dsh-prompt-refiner__switchTrack {
  position: relative;
  width: 30px;
  height: 16px;
  border-radius: 8px;
  background: var(--dsw-alias-border-l2, rgb(0 0 0 / 20%));
  transition: background-color 120ms ease;
}
.dsh-prompt-refiner__switchThumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 25%);
  transition: transform 120ms ease;
}
.dsh-prompt-refiner__switch[aria-checked="true"] .dsh-prompt-refiner__switchTrack {
  background: var(--dsw-alias-brand-primary, #4f6ef7);
}
.dsh-prompt-refiner__switch[aria-checked="true"] .dsh-prompt-refiner__switchThumb {
  transform: translateX(14px);
}
.dsh-prompt-refiner__popoverDivider {
  height: 1px;
  background: var(--dsw-alias-border-l1, rgb(0 0 0 / 8%));
  margin: 4px 0;
}
.dsh-prompt-refiner__rowButton {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #444);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  text-align: left;
  padding: 5px 2px;
  cursor: pointer;
  border-radius: 6px;
}
.dsh-prompt-refiner__rowButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%));
  color: var(--dsw-alias-label-primary, #111);
}
.dsh-prompt-refiner__rowButtonMeta {
  margin-left: auto;
  color: var(--dsw-alias-label-tertiary, #777);
  font-size: 11px;
  line-height: 16px;
}
.dsh-prompt-refiner__popoverFooter {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-top: 2px;
}
.dsh-prompt-refiner__reset {
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #777);
  font: inherit;
  font-size: 11px;
  line-height: 16px;
  padding: 2px 2px;
  cursor: pointer;
}
.dsh-prompt-refiner__reset:hover {
  color: var(--dsw-alias-label-primary, #111);
  text-decoration: underline;
}

/* ---- toast ---- */
.dsh-prompt-refiner__toast {
  box-sizing: border-box;
  position: fixed;
  z-index: 9995;
  max-width: min(340px, calc(100vw - 24px));
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 14%));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2, #fff);
  color: var(--dsw-alias-label-primary, #111);
  box-shadow: 0 8px 28px rgb(0 0 0 / 20%);
  font-size: 12px;
  line-height: 18px;
  animation: dsh-po-toast-in 150ms ease;
}
.dsh-prompt-refiner__toast--error {
  border-color: var(--dsw-alias-state-error-primary, #e43c3c);
  color: var(--dsw-alias-state-error-primary, #e43c3c);
}
@keyframes dsh-po-toast-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ---- preview dialog (unchanged look) ---- */
.dsh-prompt-refiner__overlay {
  position: fixed;
  z-index: 10000;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgb(0 0 0 / 45%);
}
.dsh-prompt-refiner__dialog {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: min(760px, 100%);
  max-height: 82vh;
  padding: 16px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 14%));
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-2, #fff);
  color: var(--dsw-alias-label-primary, #111);
  box-shadow: 0 18px 60px rgb(0 0 0 / 28%);
}
.dsh-prompt-refiner__dialogTitle {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
}
.dsh-prompt-refiner__columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  min-height: 0;
  overflow: auto;
}
.dsh-prompt-refiner__panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.dsh-prompt-refiner__panelLabel {
  color: var(--dsw-alias-label-tertiary, #777);
  font-size: 12px;
  line-height: 18px;
}
.dsh-prompt-refiner__textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 240px;
  resize: vertical;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 14%));
  border-radius: 8px;
  outline: none;
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-primary, #111);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
}
.dsh-prompt-refiner__textarea:focus {
  border-color: var(--dsw-alias-brand-primary, #4f6ef7);
}
.dsh-prompt-refiner__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.dsh-prompt-refiner__button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 14%));
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-secondary, #444);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.dsh-prompt-refiner__button:hover:not(:disabled) {
  border-color: var(--dsw-alias-brand-primary, #4f6ef7);
  background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%));
  color: var(--dsw-alias-label-primary, #111);
}
.dsh-prompt-refiner__button:disabled {
  opacity: 0.45;
  cursor: default;
}
.dsh-prompt-refiner__button--primary {
  border-color: var(--dsw-alias-button-primary-fill, #4f6ef7);
  background: var(--dsw-alias-button-primary-fill, #4f6ef7);
  color: var(--dsw-alias-label-primary-inverted, #fff);
}
.dsh-prompt-refiner__button--primary:hover:not(:disabled) {
  border-color: var(--dsw-alias-button-primary-hover, #3b5de7);
  background: var(--dsw-alias-button-primary-hover, #3b5de7);
  color: var(--dsw-alias-label-primary-inverted, #fff);
}
@media (max-width: 640px) {
  .dsh-prompt-refiner__columns {
    grid-template-columns: 1fr;
  }
  .dsh-prompt-refiner__textarea {
    min-height: 140px;
  }
}
`;

  function installStyles() {
    if (document.getElementById(STYLE_ID) !== null) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = cssText;
    document.head.appendChild(style);
  }

  function isChineseUi() {
    var lang = document.documentElement.lang || navigator.language || "zh";
    return String(lang).toLowerCase().startsWith("zh");
  }

  function findComposerTextarea() {
    return document.querySelector(
      '[data-composer-card="true"] textarea, textarea[data-input-mirror="true"]'
    );
  }

  /**
   * Current DSH composer is a Lexical `contenteditable`, not a textarea.
   * Kept as a separate lookup so the DOM fallback below can at least find
   * the editor and warn instead of dereferencing a null textarea.
   */
  function findComposerEditable() {
    return document.querySelector('[data-composer-input="true"]');
  }

  function readComposerDom() {
    var textarea = findComposerTextarea();
    if (textarea) return textarea.value;
    var editable = findComposerEditable();
    if (!editable) return "";
    return typeof editable.innerText === "string" ? editable.innerText : (editable.textContent || "");
  }

  function getComposerDraft(input) {
    if (input && typeof input.draft === "string") return input.draft;
    return readComposerDom();
  }

  /**
   * Read the draft as it is RIGHT NOW.
   *
   * `getComposerDraft(input)` must never be used inside an async callback that
   * outlives the render: the `input` object is a snapshot captured when the
   * click happened, so every later comparison compares the old draft with
   * itself and a guard built on it can never fire. The editor DOM, by
   * contrast, is the text the user is actually looking at, so it wins when
   * the composer is mounted.
   */
  function liveComposerDraft(input) {
    if (findComposerTextarea() !== null || findComposerEditable() !== null) {
      return readComposerDom();
    }
    return input && typeof input.draft === "string" ? input.draft : "";
  }

  function normalizeDraft(text) {
    return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  }

  /**
   * Write the draft back into the composer.
   *
   * Returns true only when a write path existed AND was accepted. The old
   * version returned silently, so "found nothing to write into" looked
   * exactly like success — the toast still said "已应用".
   */
  function setComposerDraft(inputActions, text) {
    if (inputActions && typeof inputActions.setDraft === "function") {
      try {
        inputActions.setDraft(text);
      } catch (error) {
        logWarn("setDraft threw", { message: String(error && error.message ? error.message : error) });
        return false;
      }
      logInfo("draft written via inputActions.setDraft", { chars: String(text).length });
      return true;
    }
    var textarea = findComposerTextarea();
    if (textarea) {
      var prototype = window.HTMLTextAreaElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(prototype, "value");
      if (setter && typeof setter.set === "function") {
        setter.set.call(textarea, text);
      } else {
        textarea.value = text;
      }
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      logWarn("draft written via textarea DOM fallback (no inputActions.setDraft)");
      return true;
    }
    logWarn("no writable composer found (inputActions.setDraft missing and no textarea)", {
      hasLexicalEditor: Boolean(findComposerEditable()),
    });
    return false;
  }

  /**
   * Best-effort confirmation: the composer state is React-owned, so the
   * only honest check is to re-read the DOM shortly after the write and
   * report a mismatch instead of assuming success.
   *
   * The first check can race React's render pass, so retry up to three
   * times (400/800/1200ms). Any matching read wins; only if all three
   * reads disagree is the write reported as unconfirmed.
   *
   * Returns a cancel function so the component can stop the timers on
   * unmount instead of touching state after teardown.
   */
  function confirmDraftWritten(expected, onMismatch) {
    var wanted = normalizeDraft(expected);
    var delays = [400, 800, 1200];
    var attempt = 0;
    var timer = null;
    var cancelled = false;

    function schedule() {
      timer = setTimeout(check, delays[attempt]);
    }

    function check() {
      if (cancelled) return;
      attempt += 1;
      var actual = normalizeDraft(readComposerDom());
      if (actual === wanted) {
        logInfo("draft write confirmed", { chars: wanted.length, tries: attempt });
        return;
      }
      if (attempt < delays.length) {
        schedule();
        return;
      }
      logWarn("draft write NOT confirmed after retries (composer still differs)", {
        expectedChars: wanted.length,
        actualChars: actual.length,
        expectedHead: wanted.slice(0, 40),
        actualHead: actual.slice(0, 40),
        tries: attempt,
      });
      if (typeof onMismatch === "function") onMismatch();
    }

    schedule();

    return function cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }

  function backupKey(sessionId) {
    return "dsh-prompt-refiner:backup:" + (sessionId || "default");
  }

  function readBackup(sessionId) {
    try {
      var raw = localStorage.getItem(backupKey(sessionId));
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data && typeof data.original === "string") return data;
    } catch (_) {
      // ignore corrupted backup
    }
    return null;
  }

  function saveBackup(sessionId, original, optimized) {
    try {
      localStorage.setItem(backupKey(sessionId), JSON.stringify({
        original: original,
        optimized: optimized,
        time: Date.now(),
      }));
    } catch (_) {
      // storage may be unavailable; optimization still works
    }
  }

  function clearBackup(sessionId) {
    try {
      localStorage.removeItem(backupKey(sessionId));
    } catch (_) {
      // ignore
    }
  }

  function pickSettings(raw) {
    var merged = {};
    for (var key in DEFAULT_SETTINGS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) continue;
      merged[key] = DEFAULT_SETTINGS[key];
    }
    if (!raw || typeof raw !== "object") return merged;
    if (STYLE_OPTIONS.indexOf(raw.style) !== -1) merged.style = raw.style;
    if (typeof raw.includeContext === "boolean") merged.includeContext = raw.includeContext;
    if (typeof raw.multiCandidate === "boolean") merged.multiCandidate = raw.multiCandidate;
    if (APPLY_OPTIONS.indexOf(raw.applyMode) !== -1) merged.applyMode = raw.applyMode;
    return merged;
  }

  function readSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return pickSettings(null);
      return pickSettings(JSON.parse(raw));
    } catch (_) {
      return pickSettings(null);
    }
  }

  function writeSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(pickSettings(settings)));
    } catch (_) {
      // settings persistence is best-effort
    }
  }

  function clearSettings() {
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch (_) {
      // ignore
    }
  }

  function SparklesIcon() {
    return React.createElement(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: "15",
        height: "15",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
      },
      React.createElement("path", {
        d: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
      }),
      React.createElement("path", { d: "M20 3v4" }),
      React.createElement("path", { d: "M22 5h-4" }),
      React.createElement("path", { d: "M4 17v2" }),
      React.createElement("path", { d: "M5 18H3" })
    );
  }

  function CaretIcon() {
    return React.createElement(
      "span",
      { className: "dsh-prompt-refiner__caretIcon", "aria-hidden": "true" },
      React.createElement(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: "14",
          height: "14",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "2",
          strokeLinecap: "round",
          strokeLinejoin: "round",
        },
        React.createElement("path", { d: "M6 9l6 6 6-6" })
      )
    );
  }

  function PromptOptimizerButton({ useInput, inputActions, directory, sessionId }) {
    var input = typeof useInput === "function" ? useInput(function (state) { return state; }) : null;
    var state = React.useSyncExternalStore(
      function (listener) {
        if (!directory || typeof directory.store?.subscribe !== "function") return function () {};
        return directory.store.subscribe(listener);
      },
      function () {
        if (!directory || typeof directory.store?.getSnapshot !== "function") return { current: null, groups: [] };
        return directory.store.getSnapshot();
      }
    );
    var current = state && state.current && state.current.provider && state.current.model
      ? state.current
      : null;
    var draft = getComposerDraft(input);
    var canOptimize = Boolean(current && draft.trim().length > 0);

    React.useEffect(function () {
      if (directory && typeof directory.load === "function") {
        try {
          void directory.load().catch(function () {});
        } catch (_) {
          // ignore load failures; the model picker will surface them
        }
      }
    }, [directory]);

    var [settings, setSettings] = React.useState(readSettings);
    var [popoverOpen, setPopoverOpen] = React.useState(false);
    var [busy, setBusy] = React.useState(false);
    var [error, setError] = React.useState(null);
    var [preview, setPreview] = React.useState(null);
    var [backup, setBackup] = React.useState(null);
    var [toast, setToast] = React.useState(null);
    var [pos, setPos] = React.useState(null);

    var groupRef = React.useRef(null);
    var caretRef = React.useRef(null);
    var popoverRef = React.useRef(null);
    var toastTimer = React.useRef(null);
    var confirmTimer = React.useRef(null);

    React.useEffect(function () {
      writeSettings(settings);
    }, [settings]);

    React.useEffect(function () {
      setBackup(readBackup(sessionId));
    }, [sessionId]);

    React.useEffect(function () {
      if (!popoverOpen) {
        setPos(null);
        return function () {};
      }
      function measure() {
        var rect = caretRef.current && caretRef.current.getBoundingClientRect();
        if (!rect) return;
        setPos({
          right: Math.max(8, window.innerWidth - rect.right),
          bottom: Math.max(8, window.innerHeight - rect.top) + 6,
        });
      }
      measure();
      window.addEventListener("resize", measure);
      window.addEventListener("scroll", measure, true);
      return function () {
        window.removeEventListener("resize", measure);
        window.removeEventListener("scroll", measure, true);
      };
    }, [popoverOpen]);

    React.useEffect(function () {
      if (!popoverOpen) return function () {};
      function onPointerDown(event) {
        var target = event.target;
        if (groupRef.current && groupRef.current.contains(target)) return;
        if (popoverRef.current && popoverRef.current.contains(target)) return;
        setPopoverOpen(false);
      }
      function onKeyDown(event) {
        if (event.key === "Escape") setPopoverOpen(false);
      }
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKeyDown, true);
      return function () {
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("keydown", onKeyDown, true);
      };
    }, [popoverOpen]);

    React.useEffect(function () {
      return function () {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        if (typeof confirmTimer.current === "function") confirmTimer.current();
      };
    }, []);

    function showToast(text, kind) {
      var rect = groupRef.current && groupRef.current.getBoundingClientRect();
      var style = { right: 12, bottom: 12 };
      if (rect) {
        style.right = Math.max(8, window.innerWidth - rect.right);
        style.bottom = Math.max(8, window.innerHeight - rect.top) + 46;
      }
      setToast({ text: text, kind: kind || "ok", style: style });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(function () {
        setToast(null);
      }, TOAST_MS);
    }

    /** Single tracked confirmation; the previous probe is cancelled so only one runs. */
    function confirmWrite(expected, onMismatch) {
      if (typeof confirmTimer.current === "function") confirmTimer.current();
      confirmTimer.current = confirmDraftWritten(expected, onMismatch);
    }

    function patchSettings(patch) {
      setSettings(function (prev) {
        var next = {};
        for (var key in prev) {
          if (Object.prototype.hasOwnProperty.call(prev, key)) next[key] = prev[key];
        }
        for (var p in patch) {
          if (Object.prototype.hasOwnProperty.call(patch, p)) next[p] = patch[p];
        }
        return next;
      });
    }

    function resetSettings() {
      clearSettings();
      setSettings(pickSettings(null));
    }

    function togglePopover() {
      setPopoverOpen(function (open) { return !open; });
    }

    var FALLBACK_LABELS_ZH = {
      "llm-error": "模型调用失败",
      "empty-result": "模型返回为空",
      "intent-check": "改写丢失了关键标记",
    };
    var FALLBACK_LABELS_EN = {
      "llm-error": "model call failed",
      "empty-result": "model returned nothing",
      "intent-check": "rewrite dropped key markers",
    };

    function fallbackLabel(reason) {
      if (!reason) return zh ? "结果与原文相同" : "identical to the original";
      var table = zh ? FALLBACK_LABELS_ZH : FALLBACK_LABELS_EN;
      return table[reason] || reason;
    }

    function optimize() {
      var text = getComposerDraft(input).trim();
      if (text === "" || !current) return;
      // Baseline for the "did the user edit while we were waiting?" check.
      // Captured from the DOM at click time so it is comparable with the DOM
      // read inside the response handler (both normalized the same way).
      var baseline = normalizeDraft(liveComposerDraft(input));
      setPopoverOpen(false);
      setBusy(true);
      setError(null);
      setToast(null);
      var requestBody = {
        provider: current.provider,
        model: current.model,
        text: text,
        style: settings.style,
        includeContext: settings.includeContext,
        ...(settings.multiCandidate ? { multiCandidate: true } : {}),
        ...(current.reasoningEffort ? { reasoningEffort: current.reasoningEffort } : {}),
        ...(settings.includeContext && sessionId ? { sessionId: sessionId } : {}),
      };
      debugState.lastRequest = {
        at: new Date().toISOString(),
        provider: requestBody.provider,
        model: requestBody.model,
        style: requestBody.style,
        includeContext: requestBody.includeContext,
        multiCandidate: requestBody.multiCandidate === true,
        applyMode: settings.applyMode,
        chars: text.length,
      };
      logInfo("optimize request", debugState.lastRequest);

      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var timeoutTimer = setTimeout(function () {
        if (controller) controller.abort();
      }, REQUEST_TIMEOUT_MS);

      fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller ? controller.signal : undefined,
      })
        .then(function (response) {
          return response.json().catch(function () {
            return { ok: false, error: { message: "HTTP " + response.status } };
          });
        })
        .then(function (data) {
          var optimized = data && typeof data.optimized === "string" ? data.optimized : "";
          var reason = data && typeof data.fallback === "string" ? data.fallback : "";
          var identical = optimized.trim() === "" || optimized.trim() === text;
          debugState.lastResponse = {
            at: new Date().toISOString(),
            ok: Boolean(data && data.ok),
            fallback: reason || null,
            optimizedChars: optimized.length,
            identicalToDraft: identical,
            head: optimized.slice(0, 60),
          };
          logInfo("optimize response", debugState.lastResponse);

          if (!data || data.ok !== true || typeof data.optimized !== "string") {
            var message = data && data.error && data.error.message
              ? data.error.message
              : "优化失败，请重试";
            throw new Error(message);
          }

          // A reply that carries the draft back unchanged is NOT success:
          // upstream silently treated it as applied, which looked exactly
          // like "the button does nothing".
          if (identical) {
            logWarn("optimize produced no change; original kept", {
              fallback: reason || "identical",
              chars: text.length,
            });
            setPreview(null);
            showToast(
              zh
                ? "模型未产生改动（" + fallbackLabel(reason) + "），已保留原文"
                : "No change from the model (" + fallbackLabel(reason) + "); draft kept",
              "error"
            );
            return;
          }

          // Whitespace-only reflow is not an optimization either: writing it
          // would also save a backup and offer a pointless "restore".
          if (normalizeDraft(optimized) === normalizeDraft(text) && optimized !== text) {
            logWarn("result differs only in whitespace", {
              fallback: reason || null,
              chars: text.length,
            });
            setPreview(null);
            showToast(zh ? "结果仅有空白/换行差异" : "Only whitespace changed", "error");
            return;
          }

          if (reason) {
            logWarn("optimize returned a changed result flagged as fallback", { fallback: reason });
          }

          if (settings.applyMode === "direct") {
            // Guard: do not clobber text the user typed while the request was in flight.
            // The DOM read is essential: `input` is a click-time snapshot and would
            // compare the old draft with itself, so the guard could never fire.
            var fresh = normalizeDraft(liveComposerDraft(input));
            if (fresh !== baseline) {
              logWarn("draft changed during request; result discarded", {
                requestChars: text.length,
                currentChars: fresh.length,
              });
              showToast(
                zh ? "草稿已变更，本次优化结果已丢弃，请重新优化" : "Draft changed; result discarded — run again",
                "error"
              );
              return;
            }
            var wrote = setComposerDraft(inputActions, data.optimized);
            if (!wrote) {
              showToast(zh ? "未能写入输入框，已保留原文" : "Could not write into the composer; draft kept", "error");
              return;
            }
            saveBackup(sessionId, text, data.optimized);
            setBackup(readBackup(sessionId));
            showToast(zh ? "已应用优化结果，点 ▾ 可还原原文" : "Optimized prompt applied; use ▾ to restore", "ok");
            confirmWrite(data.optimized, function () {
              showToast(zh ? "结果未写入输入框，请检查草稿" : "Result may not be in the composer; please check", "error");
            });
          } else {
            setPreview({ original: text, optimized: data.optimized });
          }
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") {
            logWarn("optimize aborted by client timeout", { ms: REQUEST_TIMEOUT_MS });
            setError(zh ? "优化超时（90 秒）" : "Timed out (90s)");
            showToast(zh ? "优化超时（90 秒），已保留原文" : "Timed out; draft kept", "error");
            return;
          }
          var message = err instanceof Error ? err.message : String(err);
          logWarn("optimize failed", { message: message });
          setError(message);
          showToast(message, "error");
        })
        .finally(function () {
          clearTimeout(timeoutTimer);
          setBusy(false);
        });
    }

    function applyOptimized() {
      if (!preview) return;
      var fresh = normalizeDraft(liveComposerDraft(input));
      if (fresh !== normalizeDraft(preview.original)) {
        logWarn("draft changed since preview; refusing to overwrite", {
          previewChars: preview.original.length,
          currentChars: fresh.length,
        });
        setPreview(null);
        showToast(zh ? "草稿已变更，未覆盖当前内容" : "Draft changed; not overwritten", "error");
        return;
      }
      if (preview.optimized.trim() === preview.original.trim()) {
        logWarn("preview holds an identical result; nothing to apply");
        setPreview(null);
        showToast(zh ? "优化结果与原文相同，未做改动" : "Result identical to the original; nothing applied", "error");
        return;
      }
      var wrote = setComposerDraft(inputActions, preview.optimized);
      if (!wrote) {
        setPreview(null);
        showToast(zh ? "未能写入输入框，已保留原文" : "Could not write into the composer; draft kept", "error");
        return;
      }
      saveBackup(sessionId, preview.original, preview.optimized);
      setBackup(readBackup(sessionId));
      setPreview(null);
      showToast(zh ? "已应用优化结果，点 ▾ 可还原原文" : "Optimized prompt applied; use ▾ to restore", "ok");
      confirmWrite(preview.optimized, function () {
        showToast(zh ? "结果未写入输入框，请检查草稿" : "Result may not be in the composer; please check", "error");
      });
    }

    function cancelPreview() {
      setPreview(null);
    }

    function restoreOriginal() {
      var saved = readBackup(sessionId);
      if (!saved) return;
      // A backup only describes the rewrite it belongs to. If the draft has
      // moved on since then, restoring would silently discard newer edits.
      var currentText = normalizeDraft(liveComposerDraft(input));
      if (currentText !== normalizeDraft(saved.optimized)) {
        logWarn("restore blocked: draft diverged from the optimized text", {
          currentChars: currentText.length,
          optimizedChars: String(saved.optimized || "").length,
        });
        showToast(
          zh ? "草稿已修改，无法还原到更早的版本" : "Draft changed since the rewrite; cannot restore",
          "error"
        );
        return;
      }
      if (!setComposerDraft(inputActions, saved.original)) {
        showToast(zh ? "未能写入输入框，原文未还原" : "Could not write into the composer; nothing restored", "error");
        return;
      }
      clearBackup(sessionId);
      setBackup(null);
      setPopoverOpen(false);
      showToast(zh ? "已还原原文" : "Original restored", "ok");
    }

    var zh = isChineseUi();

    var styleLabels = zh
      ? { concise: "精简", standard: "标准", detailed: "详细" }
      : { concise: "Concise", standard: "Standard", detailed: "Detailed" };
    var applyLabels = zh
      ? { direct: "直接应用", preview: "预览确认" }
      : { direct: "Apply now", preview: "Preview" };

    var styleSummary = styleLabels[settings.style] || styleLabels.standard;
    var contextSummary = settings.includeContext
      ? (zh ? "结合上下文" : "with context")
      : (zh ? "不含上下文" : "no context");

    var mainTitle;
    if (busy) {
      mainTitle = zh ? "优化中…" : "Optimizing…";
    } else if (error) {
      mainTitle = error;
    } else if (!current) {
      mainTitle = zh ? "请先选择模型" : "Select a model first";
    } else if (draft.trim() === "") {
      mainTitle = zh ? "请先输入提示词内容" : "Type a draft first";
    } else {
      mainTitle = zh
        ? "一键优化（" + styleSummary + " · " + contextSummary + "）"
        : "Optimize (" + styleSummary + ", " + contextSummary + ")";
    }

    function renderSeg(options, labels, value, onChange, ariaLabel) {
      return React.createElement(
        "div",
        { className: "dsh-prompt-refiner__seg", role: "group", "aria-label": ariaLabel },
        options.map(function (option) {
          return React.createElement(
            "button",
            {
              key: option,
              type: "button",
              "aria-pressed": value === option ? "true" : "false",
              onClick: function () { onChange(option); },
            },
            labels[option]
          );
        })
      );
    }

    function renderPopover() {
      var popoverStyle = pos;
      if (!popoverStyle) {
        var rect = caretRef.current && caretRef.current.getBoundingClientRect();
        if (rect) {
          popoverStyle = {
            right: Math.max(8, window.innerWidth - rect.right),
            bottom: Math.max(8, window.innerHeight - rect.top) + 6,
          };
        }
      }
      var restoreTime = "";
      if (backup && typeof backup.time === "number") {
        try {
          restoreTime = new Date(backup.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        } catch (_) {
          // ignore
        }
      }
      return React.createElement(
        "div",
        {
          className: "dsh-prompt-refiner__popover",
          ref: popoverRef,
          role: "dialog",
          "aria-label": zh ? "优化设置" : "Optimizer settings",
          style: popoverStyle || undefined,
        },
        React.createElement("p", { className: "dsh-prompt-refiner__popoverTitle" },
          zh ? "优化设置" : "Optimizer settings"),
        React.createElement(
          "div",
          { className: "dsh-prompt-refiner__popoverRow" },
          React.createElement(
            "div",
            { className: "dsh-prompt-refiner__popoverField" },
            React.createElement("span", { className: "dsh-prompt-refiner__popoverFieldTitle" },
              zh ? "优化风格" : "Style"),
            React.createElement("span", { className: "dsh-prompt-refiner__popoverFieldHint" },
              zh ? "默认“标准”，直接点 ✨ 即可" : "Default: standard — just click ✨")
          ),
          renderSeg(STYLE_OPTIONS, styleLabels, settings.style, function (value) {
            patchSettings({ style: value });
          }, zh ? "优化风格" : "Optimization style")
        ),
        React.createElement(
          "div",
          { className: "dsh-prompt-refiner__popoverRow" },
          React.createElement(
            "div",
            { className: "dsh-prompt-refiner__popoverField" },
            React.createElement("span", { className: "dsh-prompt-refiner__popoverFieldTitle" },
              zh ? "上下文" : "Context"),
            React.createElement("span", { className: "dsh-prompt-refiner__popoverFieldHint" },
              zh ? "结合最近对话理解草稿" : "Use recent conversation to understand the draft")
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "dsh-prompt-refiner__switch",
              role: "switch",
              "aria-checked": settings.includeContext ? "true" : "false",
              "aria-label": zh ? "结合最近对话理解草稿" : "Use recent conversation as context",
              onClick: function () { patchSettings({ includeContext: !settings.includeContext }); },
            },
            React.createElement(
              "span",
              { className: "dsh-prompt-refiner__switchTrack" },
              React.createElement("span", { className: "dsh-prompt-refiner__switchThumb" })
            )
          )
        ),
        React.createElement(
          "div",
          { className: "dsh-prompt-refiner__popoverRow" },
          React.createElement(
            "div",
            { className: "dsh-prompt-refiner__popoverField" },
            React.createElement("span", { className: "dsh-prompt-refiner__popoverFieldTitle" },
              zh ? "多候选" : "Multi-candidate"),
            React.createElement("span", { className: "dsh-prompt-refiner__popoverFieldHint" },
              zh ? "开启后当前档位生成两个候选择优，更优但更慢" : "Generate two candidates and keep the better one — better but slower")
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "dsh-prompt-refiner__switch",
              role: "switch",
              "aria-checked": settings.multiCandidate ? "true" : "false",
              "aria-label": zh ? "开启后当前档位生成两个候选择优，更优但更慢" : "Generate two candidates and keep the better one",
              onClick: function () { patchSettings({ multiCandidate: !settings.multiCandidate }); },
            },
            React.createElement(
              "span",
              { className: "dsh-prompt-refiner__switchTrack" },
              React.createElement("span", { className: "dsh-prompt-refiner__switchThumb" })
            )
          )
        ),
        React.createElement(
          "div",
          { className: "dsh-prompt-refiner__popoverRow" },
          React.createElement(
            "div",
            { className: "dsh-prompt-refiner__popoverField" },
            React.createElement("span", { className: "dsh-prompt-refiner__popoverFieldTitle" },
              zh ? "应用方式" : "Apply"),
            React.createElement("span", { className: "dsh-prompt-refiner__popoverFieldHint" },
              zh ? "直接应用后可从 ▾ 一键还原原文" : "Direct apply can be undone from ▾")
          ),
          renderSeg(APPLY_OPTIONS, applyLabels, settings.applyMode, function (value) {
            patchSettings({ applyMode: value });
          }, zh ? "结果应用方式" : "How to apply the result")
        ),
        backup && !preview
          ? React.createElement(React.Fragment, null,
              React.createElement("div", { className: "dsh-prompt-refiner__popoverDivider" }),
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-prompt-refiner__rowButton",
                  onClick: restoreOriginal,
                  title: zh ? "还原到上次优化前的原文" : "Restore the text from before the last optimization",
                  "aria-label": zh ? "还原原文" : "Restore original",
                },
                React.createElement("span", null, zh ? "↩ 还原原文" : "↩ Restore original"),
                restoreTime === ""
                  ? null
                  : React.createElement("span", { className: "dsh-prompt-refiner__rowButtonMeta" }, restoreTime)
              )
            )
          : null,
        React.createElement(
          "div",
          { className: "dsh-prompt-refiner__popoverFooter" },
          React.createElement(
            "button",
            { type: "button", className: "dsh-prompt-refiner__reset", onClick: resetSettings },
            zh ? "恢复默认设置" : "Reset to defaults"
          )
        )
      );
    }

    function renderToast() {
      if (!toast) return null;
      return React.createElement(
        "div",
        {
          className: "dsh-prompt-refiner__toast"
            + (toast.kind === "error" ? " dsh-prompt-refiner__toast--error" : ""),
          role: "status",
          style: toast.style,
        },
        toast.text
      );
    }

    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "div",
        { className: "dsh-prompt-refiner", "data-plugin": PACKAGE_ID, ref: groupRef },
        React.createElement(
          "button",
          {
            type: "button",
            className: "dsh-prompt-refiner__main",
            "data-plugin": PACKAGE_ID,
            "data-busy": busy ? "true" : undefined,
            disabled: busy || !canOptimize,
            onClick: optimize,
            title: mainTitle,
            "aria-label": zh ? "优化提示词" : "Optimize prompt",
          },
          busy
            ? React.createElement("span", { className: "dsh-prompt-refiner__spinner", "aria-hidden": "true" })
            : React.createElement(SparklesIcon, null)
        ),
        React.createElement(
          "button",
          {
            type: "button",
            ref: caretRef,
            className: "dsh-prompt-refiner__caret",
            "aria-label": zh ? "优化设置（风格 / 上下文 / 还原）" : "Optimizer settings",
            "aria-expanded": popoverOpen ? "true" : "false",
            "aria-haspopup": "dialog",
            disabled: busy,
            onClick: togglePopover,
            title: zh ? "优化设置" : "Optimizer settings",
          },
          React.createElement(CaretIcon, null)
        ),
        backup && !preview
          ? React.createElement("span", { className: "dsh-prompt-refiner__dot", "aria-hidden": "true" })
          : null
      ),
      popoverOpen
        ? ReactDOM.createPortal(renderPopover(), document.body)
        : null,
      preview
          ? ReactDOM.createPortal(
        React.createElement(
            "div",
            { className: "dsh-prompt-refiner__overlay", role: "presentation" },
            React.createElement(
              "div",
              {
                className: "dsh-prompt-refiner__dialog",
                role: "dialog",
                "aria-modal": "true",
                "aria-label": zh ? "优化结果预览" : "Optimization preview",
              },
              React.createElement("h3", { className: "dsh-prompt-refiner__dialogTitle" }, zh ? "优化结果预览" : "Optimization preview"),
              React.createElement(
                "div",
                { className: "dsh-prompt-refiner__columns" },
                React.createElement(
                  "div",
                  { className: "dsh-prompt-refiner__panel" },
                  React.createElement("span", { className: "dsh-prompt-refiner__panelLabel" }, zh ? "原文" : "Original"),
                  React.createElement("textarea", { className: "dsh-prompt-refiner__textarea", readOnly: true, value: preview.original })
                ),
                React.createElement(
                  "div",
                  { className: "dsh-prompt-refiner__panel" },
                  React.createElement("span", { className: "dsh-prompt-refiner__panelLabel" }, zh ? "优化后" : "Optimized"),
                  React.createElement("textarea", { className: "dsh-prompt-refiner__textarea", readOnly: true, value: preview.optimized })
                )
              ),
              React.createElement(
                "div",
                { className: "dsh-prompt-refiner__footer" },
                React.createElement(
                  "button",
                  { type: "button", className: "dsh-prompt-refiner__button", onClick: cancelPreview },
                  zh ? "取消" : "Cancel"
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "dsh-prompt-refiner__button dsh-prompt-refiner__button--primary",
                    onClick: applyOptimized,
                    disabled: preview.optimized.trim() === preview.original.trim(),
                  },
                  zh ? "使用优化结果" : "Use optimized"
                )
              )
            )
          ),
          document.body
        )
        : null,
      toast
        ? ReactDOM.createPortal(renderToast(), document.body)
        : null
    );
  }

  function apply(ctx) {
    ctx.effect(function () {
      installStyles();
      resolvePluginVersion();
      return function () {
        var style = document.getElementById(STYLE_ID);
        if (style) style.remove();
      };
    }, "dsh-prompt-refiner: styles");

    ctx.slots.inject("conversation.input.right", function () {
      return ctx.slots.register(
        {
          name: "conversation.input.right",
          id: "prompt-refiner",
          order: 5,
          label: function () { return "提示词润色"; },
          inject: function (sessionId) {
            var directory = ctx.modelDirectories.directoryFor(sessionId);
            if (!directory) {
              throw new Error("dsh-prompt-refiner: model directory is unavailable");
            }
            return { directory: directory, sessionId: sessionId };
          },
        },
        PromptOptimizerButton
      );
    });
  }

  exports.name = PACKAGE_ID;
  exports.inject = ["slots", "modelDirectories"];
  exports.apply = apply;
  return module.exports;
}});
