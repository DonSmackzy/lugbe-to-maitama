// =============================================================================
// Global Error Boundary & Branded UI Modal — apps/web/src/ui/ErrorHandler.ts
// Replaces raw Vite/browser stack traces with a production-ready, dark-themed
// civic emergency modal. Never leaks raw technical stack traces into the DOM.
// =============================================================================

export type ErrorClassificationCode =
  | "ERR_MAP_LOAD"
  | "ERR_WS_DROP"
  | "ERR_WEBGL_CONTEXT"
  | "ERR_LEDGER_SYNC"
  | "ERR_SYSTEM_FAULT";

interface ErrorDetails {
  code: ErrorClassificationCode;
  title: string;
  message: string;
}

/**
 * Classifies runtime exceptions into user-friendly civic error categories.
 */
export function classifyError(error: unknown): ErrorDetails {
  const errStr =
    error instanceof Error
      ? `${error.name} ${error.message} ${error.stack ?? ""}`
      : String(error ?? "");

  const lower = errStr.toLowerCase();

  // 1. Map / GIS / WebGL / Tilemap issues
  if (
    lower.includes("map") ||
    lower.includes("geojson") ||
    lower.includes("tilemap") ||
    lower.includes("polygon") ||
    lower.includes("geometry") ||
    lower.includes("isometric") ||
    lower.includes("projection")
  ) {
    return {
      code: "ERR_MAP_LOAD",
      title: "Transit Grid Error",
      message:
        "The Abuja spatial navigation grid encountered an issue loading real-world road vectors. Street routes are temporarily unmapped.",
    };
  }

  // 2. Colyseus / WebSocket / Network drops
  if (
    lower.includes("websocket") ||
    lower.includes("colyseus") ||
    lower.includes("network") ||
    lower.includes("connection closed") ||
    lower.includes("failed to fetch") ||
    lower.includes("offline")
  ) {
    return {
      code: "ERR_WS_DROP",
      title: "Commuter Network Disconnected",
      message:
        "Real-time dispatch signal lost. Your vehicle tracker lost connection to the Abuja Municipal Area Council server.",
    };
  }

  // 3. WebGL / Graphics pipeline crashes
  if (
    lower.includes("webgl") ||
    lower.includes("context lost") ||
    lower.includes("shader") ||
    lower.includes("gl_") ||
    lower.includes("canvas")
  ) {
    return {
      code: "ERR_WEBGL_CONTEXT",
      title: "Display Pipeline Interrupted",
      message:
        "Your browser graphics driver encountered an interruption rendering the city layer. Resetting the renderer is advised.",
    };
  }

  // 4. Ledger & Financial Transaction sync issues
  if (
    lower.includes("ledger") ||
    lower.includes("kobo") ||
    lower.includes("wallet") ||
    lower.includes("balance") ||
    lower.includes("bribe")
  ) {
    return {
      code: "ERR_LEDGER_SYNC",
      title: "Commuter Ledger Out of Sync",
      message:
        "Your civic cash transaction could not be reconciled with the treasury authority.",
    };
  }

  // 5. Default unexpected system fault
  return {
    code: "ERR_SYSTEM_FAULT",
    title: "Civic Disruption Detected",
    message:
      "An unexpected disruption occurred along your transit route. Traffic authorities are redirecting active commuters.",
  };
}

let modalMounted = false;

/**
 * Injects a branded dark-themed modal over the game canvas.
 * Technical stack traces are explicitly kept out of the DOM.
 */
export function showFatalErrorModal(
  code: ErrorClassificationCode,
  title: string,
  message: string
): void {
  // If modal already mounted, avoid duplicate injection
  if (modalMounted) return;
  modalMounted = true;

  // Create overlay container
  const overlay = document.createElement("div");
  overlay.id = "fatal-error-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(9, 13, 22, 0.94);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
    color: #f8fafc;
    box-sizing: border-box;
    padding: 24px;
    animation: fadeInModal 0.3s ease-out;
  `;

  overlay.innerHTML = `
    <style>
      @keyframes fadeInModal {
        from { opacity: 0; transform: scale(0.98); }
        to { opacity: 1; transform: scale(1); }
      }
      .err-card {
        background: #111827;
        border: 1px solid #374151;
        border-radius: 14px;
        max-width: 500px;
        width: 100%;
        padding: 32px 28px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 20px rgba(239, 68, 68, 0.15);
        text-align: center;
        box-sizing: border-box;
      }
      .err-icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 20px;
        background: rgba(239, 68, 68, 0.12);
        border: 1px solid rgba(239, 68, 68, 0.3);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
      }
      .err-title {
        font-size: 22px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: #f9fafb;
        margin: 0 0 10px;
      }
      .err-badge {
        display: inline-block;
        font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #f87171;
        background: rgba(239, 68, 68, 0.15);
        border: 1px solid rgba(239, 68, 68, 0.3);
        border-radius: 6px;
        padding: 4px 10px;
        margin-bottom: 16px;
      }
      .err-msg {
        font-size: 14px;
        line-height: 1.6;
        color: #9ca3af;
        margin: 0 0 28px;
      }
      .err-btn-group {
        display: flex;
        gap: 12px;
        justify-content: center;
      }
      .err-btn-primary {
        background: #10b981;
        color: #ffffff;
        border: none;
        border-radius: 8px;
        padding: 12px 24px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s, transform 0.1s;
      }
      .err-btn-primary:hover {
        background: #059669;
        transform: translateY(-1px);
      }
      .err-btn-secondary {
        background: #1f2937;
        color: #d1d5db;
        border: 1px solid #4b5563;
        border-radius: 8px;
        padding: 12px 20px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      }
      .err-btn-secondary:hover {
        background: #374151;
      }
      .err-footer {
        margin-top: 24px;
        font-size: 11px;
        color: #6b7280;
      }
    </style>
    <div class="err-card">
      <div class="err-icon">⚠️</div>
      <h2 class="err-title">${escapeHtml(title)}</h2>
      <div class="err-badge">${escapeHtml(code)}</div>
      <p class="err-msg">${escapeHtml(message)}</p>
      <div class="err-btn-group">
        <button id="err-btn-reload" class="err-btn-primary">Reconnect Transit</button>
        <button id="err-btn-dismiss" class="err-btn-secondary">Dismiss</button>
      </div>
      <div class="err-footer">Federal Capital Territory Civil Navigation Authority</div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Wire up action buttons
  const reloadBtn = document.getElementById("err-btn-reload");
  reloadBtn?.addEventListener("click", () => {
    window.location.reload();
  });

  const dismissBtn = document.getElementById("err-btn-dismiss");
  dismissBtn?.addEventListener("click", () => {
    overlay.remove();
    modalMounted = false;
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Initializes global error listeners on window:
 * - window.onerror
 * - window.onunhandledrejection
 * Intercepts uncaught exceptions and triggers the branded UI modal.
 */
export function initGlobalErrorBoundary(): void {
  if (typeof window === "undefined") return;

  // 1. Uncaught runtime exceptions
  window.addEventListener("error", (event: ErrorEvent) => {
    const error = event.error ?? event.message;
    console.error("[error-boundary:uncaught]", error);

    const details = classifyError(error);
    showFatalErrorModal(details.code, details.title, details.message);

    // Prevent default browser console noise or crash overlay
    event.preventDefault();
  });

  // 2. Unhandled Promise Rejections
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    console.error("[error-boundary:unhandled-rejection]", reason);

    const details = classifyError(reason);
    showFatalErrorModal(details.code, details.title, details.message);

    // Prevent default browser unhandled rejection alert
    event.preventDefault();
  });

  console.log("[error-boundary] Production branded error boundary initialized");
}
