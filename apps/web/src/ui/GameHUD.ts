// =============================================================================
// DOM-Based HUD & Anti-XSS Dialogue Overlay — apps/web/src/ui/GameHUD.ts
// UI FIX: Container uses pointer-events: none so clicks pass through to Phaser canvas.
// SECURITY FIX: Dialogue strings are rendered strictly via textContent (NEVER innerHTML).
// =============================================================================

export interface HUDState {
  username: string;
  districtId: string;
  balanceKobo: number;
  energy: number;
  socialCapital: number;
  tick?: number;
  day?: number;
}

export type ActionCallback = (action: string) => void;

export class GameHUD {
  private container: HTMLElement;
  private onActionHandler: ActionCallback | null = null;

  // DOM element references
  private balanceEl!: HTMLElement;
  private energyFillEl!: HTMLElement;
  private energyTextEl!: HTMLElement;
  private socialCapitalEl!: HTMLElement;
  private districtBadgeEl!: HTMLElement;
  private commuterTaxNoticeEl!: HTMLElement;

  // Dialogue elements
  private dialogueModal!: HTMLElement;
  private speakerNameEl!: HTMLElement;
  private archetypeTagEl!: HTMLElement;
  private dialogueContentEl!: HTMLElement;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.id = "hud-overlay";
    this.container.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 100;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 18px 24px;
      font-family: var(--font-main, system-ui, sans-serif);
      user-select: none;
    `;

    this.render();
    parent.appendChild(this.container);
  }

  private render(): void {
    this.container.innerHTML = `
      <!-- Top HUD Bar -->
      <div style="
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        width: 100%;
      ">
        <!-- Player Stats Card -->
        <div class="glass-panel" style="
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 20px;
          padding: 12px 20px;
          border-radius: 12px;
          backdrop-filter: blur(12px);
          background: rgba(10, 15, 26, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        ">
          <!-- Citizen Identity & District -->
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span id="hud-username" style="color: #fff; font-weight: 700; font-size: 0.95rem;">Citizen</span>
              <span id="hud-district-badge" style="
                background: rgba(234, 88, 12, 0.2);
                border: 1px solid rgba(234, 88, 12, 0.4);
                color: #fb923c;
                font-size: 0.7rem;
                font-weight: 700;
                padding: 2px 8px;
                border-radius: 999px;
                text-transform: uppercase;
              ">Lugbe</span>
            </div>
            <div id="hud-tax-notice" style="
              font-size: 0.72rem;
              color: #f87171;
              font-weight: 600;
            ">
              ⚠️ Commuter Tax Active: -18 Energy / Day
            </div>
          </div>

          <div style="width: 1px; height: 36px; background: rgba(255, 255, 255, 0.1);"></div>

          <!-- Live Naira Balance (Kobo / 100) -->
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="font-size: 0.68rem; color: var(--text-muted, #94a3b8); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
              Wallet (NGN)
            </span>
            <span id="hud-balance" style="
              color: var(--accent-gold, #fbbf24);
              font-family: var(--font-display, monospace);
              font-weight: 800;
              font-size: 1.25rem;
              letter-spacing: -0.5px;
            ">
              ₦5,000.00
            </span>
          </div>

          <div style="width: 1px; height: 36px; background: rgba(255, 255, 255, 0.1);"></div>

          <!-- Energy Bar -->
          <div style="display: flex; flex-direction: column; gap: 4px; min-width: 110px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.7rem; font-weight: 700;">
              <span style="color: #94a3b8;">ENERGY</span>
              <span id="hud-energy-text" style="color: #00e676;">100%</span>
            </div>
            <div style="
              width: 100%;
              height: 7px;
              background: rgba(255, 255, 255, 0.1);
              border-radius: 999px;
              overflow: hidden;
            ">
              <div id="hud-energy-fill" style="
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, #00e676, #00b0ff);
                border-radius: 999px;
                transition: width 0.3s ease;
              "></div>
            </div>
          </div>

          <div style="width: 1px; height: 36px; background: rgba(255, 255, 255, 0.1);"></div>

          <!-- Social Capital Meter -->
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="font-size: 0.68rem; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
              Social Capital
            </span>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="color: #38bdf8;">⭐</span>
              <span id="hud-social-capital" style="color: #fff; font-weight: 800; font-size: 1.05rem;">
                10 SC
              </span>
            </div>
          </div>
        </div>

        <!-- Connection / Controls Help -->
        <div class="glass-panel" style="
          pointer-events: auto;
          padding: 8px 14px;
          border-radius: 10px;
          background: rgba(10, 15, 26, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #94a3b8;
          font-size: 0.75rem;
          display: flex;
          align-items: center;
          gap: 12px;
        ">
          <span>🎮 WASD / Arrows to Move</span>
          <span style="opacity: 0.4;">|</span>
          <span>Click to Move & Interact</span>
        </div>
      </div>

      <!-- Dialogue Modal (Bottom-Center) -->
      <div id="dialogue-modal" style="
        display: none;
        pointer-events: auto;
        align-self: center;
        width: 100%;
        max-width: 680px;
        margin-bottom: 20px;
        background: rgba(13, 19, 33, 0.95);
        border: 1px solid rgba(251, 191, 36, 0.4);
        border-radius: 14px;
        padding: 20px 24px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(16px);
        flex-direction: column;
        gap: 12px;
        animation: slideUp 0.3s ease-out;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span id="dialogue-speaker-name" style="
              color: var(--accent-gold, #fbbf24);
              font-weight: 800;
              font-size: 1.1rem;
            ">Alhaji Tanko</span>
            <span id="dialogue-archetype-tag" style="
              background: rgba(255, 255, 255, 0.1);
              padding: 2px 8px;
              border-radius: 6px;
              font-size: 0.7rem;
              color: #cbd5e1;
              text-transform: uppercase;
              font-weight: 700;
            ">Driver</span>
          </div>
          <button id="dialogue-close-btn" style="
            background: transparent;
            border: none;
            color: #94a3b8;
            font-size: 1.2rem;
            cursor: pointer;
            padding: 4px;
            line-height: 1;
          ">&times;</button>
        </div>

        <!-- Dialogue Text Container — Rendered with strict textContent -->
        <p id="dialogue-content-text" style="
          color: #f1f5f9;
          font-size: 1rem;
          line-height: 1.5;
          margin: 0;
          font-weight: 400;
        "></p>

        <div style="display: flex; justify-content: flex-end; margin-top: 4px;">
          <button id="dialogue-next-btn" style="
            background: linear-gradient(135deg, #fbbf24, #d97706);
            color: #000;
            border: none;
            border-radius: 8px;
            padding: 8px 18px;
            font-size: 0.85rem;
            font-weight: 700;
            cursor: pointer;
          ">CONTINUE →</button>
        </div>
      </div>

      <!-- Bottom Floating Action Bar -->
      <div style="
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 12px;
      ">
        <div style="
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(10, 15, 26, 0.85);
          padding: 8px 14px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        ">
          <button id="btn-action-commute" class="hud-action-btn" style="
            background: rgba(234, 88, 12, 0.2);
            border: 1px solid rgba(234, 88, 12, 0.4);
            color: #fb923c;
            padding: 8px 14px;
            border-radius: 8px;
            font-weight: 700;
            font-size: 0.82rem;
            cursor: pointer;
          ">
            🚖 Commute (Along)
          </button>

          <button id="btn-action-bolt" class="hud-action-btn" style="
            background: rgba(16, 185, 129, 0.2);
            border: 1px solid rgba(16, 185, 129, 0.4);
            color: #34d399;
            padding: 8px 14px;
            border-radius: 8px;
            font-weight: 700;
            font-size: 0.82rem;
            cursor: pointer;
          ">
            🚗 Ride-Hail (Bolt)
          </button>

          <button id="btn-action-gala" class="hud-action-btn" style="
            background: rgba(0, 230, 118, 0.15);
            border: 1px solid rgba(0, 230, 118, 0.3);
            color: #00e676;
            padding: 8px 14px;
            border-radius: 8px;
            font-weight: 700;
            font-size: 0.82rem;
            cursor: pointer;
          ">
            🥖 Buy Gala (₦200)
          </button>

          <button id="btn-action-water" class="hud-action-btn" style="
            background: rgba(56, 189, 248, 0.15);
            border: 1px solid rgba(56, 189, 248, 0.3);
            color: #38bdf8;
            padding: 8px 14px;
            border-radius: 8px;
            font-weight: 700;
            font-size: 0.82rem;
            cursor: pointer;
          ">
            💧 Pure Water (₦50)
          </button>
        </div>
      </div>
    `;

    // Cache element references
    this.balanceEl = this.container.querySelector("#hud-balance")!;
    this.energyFillEl = this.container.querySelector("#hud-energy-fill")!;
    this.energyTextEl = this.container.querySelector("#hud-energy-text")!;
    this.socialCapitalEl = this.container.querySelector("#hud-social-capital")!;
    this.districtBadgeEl = this.container.querySelector("#hud-district-badge")!;
    this.commuterTaxNoticeEl = this.container.querySelector("#hud-tax-notice")!;

    this.dialogueModal = this.container.querySelector("#dialogue-modal")!;
    this.speakerNameEl = this.container.querySelector("#dialogue-speaker-name")!;
    this.archetypeTagEl = this.container.querySelector("#dialogue-archetype-tag")!;
    this.dialogueContentEl = this.container.querySelector("#dialogue-content-text")!;

    // Event listeners for dialogue
    const closeBtn = this.container.querySelector("#dialogue-close-btn");
    const nextBtn = this.container.querySelector("#dialogue-next-btn");
    closeBtn?.addEventListener("click", () => this.hideDialogue());
    nextBtn?.addEventListener("click", () => this.hideDialogue());

    // Event listeners for quick actions
    this.container.querySelector("#btn-action-commute")?.addEventListener("click", () => {
      this.onActionHandler?.("COMMUTE");
    });
    this.container.querySelector("#btn-action-bolt")?.addEventListener("click", () => {
      this.onActionHandler?.("COMMUTE_BOLT");
    });
    this.container.querySelector("#btn-action-gala")?.addEventListener("click", () => {
      this.onActionHandler?.("BUY_GALA");
    });
    this.container.querySelector("#btn-action-water")?.addEventListener("click", () => {
      this.onActionHandler?.("BUY_WATER");
    });
  }

  public onAction(handler: ActionCallback): void {
    this.onActionHandler = handler;
  }

  /**
   * Updates HUD meters with authoritative wallet and state data.
   */
  public update(state: HUDState): void {
    // 1. Naira = kobo / 100
    const nairaVal = (state.balanceKobo / 100).toLocaleString("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 2,
    });
    this.balanceEl.textContent = nairaVal;

    // 2. Energy Bar (0 - 100)
    const energyPercent = Math.max(0, Math.min(100, state.energy));
    this.energyTextEl.textContent = `${energyPercent}%`;
    this.energyFillEl.style.width = `${energyPercent}%`;

    if (energyPercent > 50) {
      this.energyFillEl.style.background = "linear-gradient(90deg, #00e676, #00b0ff)";
      this.energyTextEl.style.color = "#00e676";
    } else if (energyPercent > 20) {
      this.energyFillEl.style.background = "linear-gradient(90deg, #fbbf24, #f59e0b)";
      this.energyTextEl.style.color = "#fbbf24";
    } else {
      this.energyFillEl.style.background = "linear-gradient(90deg, #ef4444, #b91c1c)";
      this.energyTextEl.style.color = "#ef4444";
    }

    // 3. Social Capital
    this.socialCapitalEl.textContent = `${state.socialCapital} SC`;

    // 4. District & Commuter Tax Notice
    const districtFormatted = state.districtId.replace(/_/g, " ").toUpperCase();
    this.districtBadgeEl.textContent = districtFormatted;

    if (state.districtId === "lugbe" || state.districtId === "karu" || state.districtId === "gwarinpa") {
      this.commuterTaxNoticeEl.style.display = "block";
      this.commuterTaxNoticeEl.textContent = "⚠️ Commuter Tax Active: -18 Energy / Day Tick";
    } else if (state.districtId === "the_villa") {
      this.commuterTaxNoticeEl.style.display = "block";
      this.commuterTaxNoticeEl.style.color = "#fbbf24";
      this.commuterTaxNoticeEl.textContent = "🏛️ The Villa: Apex Power Perimeter";
    } else {
      this.commuterTaxNoticeEl.style.display = "none";
    }

    const usernameEl = this.container.querySelector("#hud-username");
    if (usernameEl && state.username) {
      usernameEl.textContent = state.username;
    }
  }

  /**
   * Displays NPC dialogue.
   * STRICT SECURITY GUARANTEE: Uses textContent only to render LLM responses.
   * Completely immune to XSS injection attempts.
   */
  public showDialogue(speaker: string, archetype: string, dialogueText: string): void {
    this.speakerNameEl.textContent = speaker;
    this.archetypeTagEl.textContent = archetype.toUpperCase();

    // CRITICAL SECURITY FIX: STRICT textContent ONLY.
    this.dialogueContentEl.textContent = dialogueText;

    this.dialogueModal.style.display = "flex";
  }

  public hideDialogue(): void {
    this.dialogueModal.style.display = "none";
  }
}
