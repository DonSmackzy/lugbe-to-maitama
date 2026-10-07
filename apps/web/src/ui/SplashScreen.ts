// =============================================================================
// SplashScreen & Login UI Component
// Prominently displays legal disclaimer, satirical context, and player onboarding.
// =============================================================================

import { getDefaultServerUrl } from "../network/ColyseusClient.js";

export const LEGAL_DISCLAIMER_TEXT =
  "DISCLAIMER: Lugbe to Maitama is a work of fiction and satire. All names, characters, businesses, places, events, and incidents are either the products of the creator's imagination or used in a fictitious manner. Any resemblance to actual persons (living or dead), including the 'President' or any government officials, is purely coincidental.";

export type LoginCallback = (credentials: {
  username: string;
  startingDistrict: "lugbe" | "karu" | "gwarinpa";
  disclaimerAccepted: boolean;
  disclaimerAcceptedAt: number;
}) => void;

export function renderSplashScreen(container: HTMLElement, onLogin: LoginCallback): void {
  container.innerHTML = `
    <div style="
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    ">
      <div class="glass-panel" style="
        width: 100%;
        max-width: 580px;
        padding: 40px;
        display: flex;
        flex-direction: column;
        gap: 24px;
        animation: fadeIn 0.6s ease-out;
      ">
        <!-- Logo & Header -->
        <div style="text-align: center;">
          <div style="
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(0, 230, 118, 0.1);
            border: 1px solid var(--border-glow);
            padding: 6px 16px;
            border-radius: 999px;
            font-size: 0.8rem;
            color: var(--accent-green);
            font-weight: 600;
            margin-bottom: 16px;
            letter-spacing: 0.5px;
          ">
            <span>🇳🇬 ABUJA ISOMETRIC MULTIPLAYER</span>
            <span style="opacity: 0.5;">•</span>
            <span style="color: var(--accent-gold);">V1.0 LIVE</span>
          </div>

          <h1 class="glow-title" style="font-size: 2.8rem; font-weight: 900; line-height: 1.1; margin-bottom: 8px;">
            Lugbe to Maitama
          </h1>
          <p style="color: var(--text-muted); font-size: 1.05rem;">
            Survive the commute. Hustle the civil service. Rise to the Villa.
          </p>
        </div>

        <!-- Prominent Legal Disclaimer -->
        <div class="disclaimer-box" id="legal-disclaimer-box">
          <div class="disclaimer-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            LEGAL NOTICE & STATUTORY NOTICE
          </div>
          <p id="disclaimer-text" style="font-weight: 500;">
            ${LEGAL_DISCLAIMER_TEXT}
          </p>
        </div>

        <!-- Onboarding Form -->
        <form id="onboarding-form" style="display: flex; flex-direction: column; gap: 16px;">
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">
              Citizen Alias / Tag
            </label>
            <input
              id="player-username"
              type="text"
              required
              placeholder="e.g. Oga_Mezie, Chief_Chinedu"
              value="Citizen_${Math.floor(1000 + Math.random() * 9000)}"
              style="
                background: rgba(10, 14, 22, 0.8);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 10px;
                padding: 14px 18px;
                color: #fff;
                font-size: 1rem;
                font-family: var(--font-main);
                outline: none;
                transition: border-color 0.2s;
              "
            />
          </div>

          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">
              Starting Satellite Quarter
            </label>
            <select
              id="player-district"
              style="
                background: rgba(10, 14, 22, 0.8);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 10px;
                padding: 14px 18px;
                color: #fff;
                font-size: 1rem;
                font-family: var(--font-main);
                outline: none;
                cursor: pointer;
              "
            >
              <option value="lugbe">Lugbe (Airport Road — High Traffic, High Grit)</option>
              <option value="karu">Karu (Expressway Junction — Transport Hub)</option>
              <option value="gwarinpa">Gwarinpa (Large Estate Outskirts)</option>
            </select>
          </div>

          <div style="display: flex; align-items: flex-start; gap: 10px; margin-top: 4px;">
            <input type="checkbox" id="consent-check" required checked style="margin-top: 4px; cursor: pointer; accent-color: var(--accent-green);" />
            <label for="consent-check" style="font-size: 0.82rem; color: var(--text-muted); cursor: pointer; line-height: 1.4;">
              I acknowledge the satirical nature of this simulation and agree to the Federal Republic of Abuja terms of residence.
            </label>
          </div>

          <button type="submit" class="btn-primary" style="margin-top: 8px;">
            ENTER ABUJA (JOIN SERVER) →
          </button>
        </form>

        <!-- Status footer -->
        <div style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-top: 16px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          font-size: 0.8rem;
          color: var(--text-subtle);
        ">
          <span>Engine: @ltm/engine (Pure TS)</span>
          <span>Colyseus: ${getDefaultServerUrl()}</span>
        </div>
      </div>
    </div>
  `;

  const form = container.querySelector("#onboarding-form") as HTMLFormElement;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const usernameInput = container.querySelector("#player-username") as HTMLInputElement;
    const districtSelect = container.querySelector("#player-district") as HTMLSelectElement;
    const consentCheck = container.querySelector("#consent-check") as HTMLInputElement;

    if (!consentCheck?.checked) {
      alert("You must acknowledge the legal and satire disclaimer before proceeding.");
      return;
    }

    onLogin({
      username: usernameInput.value.trim() || "Citizen_Anonymous",
      startingDistrict: districtSelect.value as "lugbe" | "karu" | "gwarinpa",
      disclaimerAccepted: true,
      disclaimerAcceptedAt: Date.now(),
    });
  });
}
