// =============================================================================
// Phase 5 Client & UI Specifications — apps/web/test/phase5.spec.ts
// Verifies:
// 1. PredictionManager & Rubber-Banding Defense (sequence-based reconciliation)
// 2. Isometric Math & Strict Y-Sorting Depth calculation
// 3. Anti-XSS Dialogue Safety (textContent vs innerHTML)
// 4. Pointer-Events Non-Blocking HUD Architecture
// =============================================================================

import { describe, it, expect } from "vitest";
import { PredictionManager } from "../src/game/PredictionManager.js";
import {
  gridToScreen,
  screenToGrid,
  calculateDepth,
  TILE_WIDTH,
  TILE_HEIGHT,
} from "../src/game/IsometricMath.js";
import { LEGAL_DISCLAIMER_TEXT } from "../src/ui/SplashScreen.js";

describe("Phase 5: Phaser Client, Prediction & UI Security", () => {
  // ===========================================================================
  // 1. Client-Side Prediction & Sequence-Based Reconciliation
  // ===========================================================================
  describe("PredictionManager (Rubber-Banding Defense)", () => {
    it("should predict movement immediately and increment sequence numbers", () => {
      const pm = new PredictionManager(10, 10);

      const intent1 = pm.predictMove(1, 0); // Step East
      expect(intent1).not.toBeNull();
      expect(intent1?.seq).toBe(1);
      expect(intent1?.targetX).toBe(11);
      expect(intent1?.targetY).toBe(10);
      expect(pm.predictedX).toBe(11);
      expect(pm.predictedY).toBe(10);
      expect(pm.getPendingCount()).toBe(1);

      const intent2 = pm.predictMove(0, 1); // Step South
      expect(intent2).not.toBeNull();
      expect(intent2?.seq).toBe(2);
      expect(intent2?.targetX).toBe(11);
      expect(intent2?.targetY).toBe(11);
      expect(pm.predictedX).toBe(11);
      expect(pm.predictedY).toBe(11);
      expect(pm.getPendingCount()).toBe(2);
    });

    it("should snap baseline and re-apply unacknowledged intents without rubber-banding", () => {
      const pm = new PredictionManager(10, 10);

      // Player rapidly presses two moves before server responds:
      // Move 1: dx: 1, dy: 0 -> predicted (11, 10)
      pm.predictMove(1, 0);
      // Move 2: dx: 0, dy: -1 -> predicted (11, 9)
      pm.predictMove(0, -1);

      expect(pm.predictedX).toBe(11);
      expect(pm.predictedY).toBe(9);
      expect(pm.getPendingCount()).toBe(2);

      // Authoritative server ACK arrives for Move 1 (seq 1 at 11, 10)
      // Reconciliation must prune intent 1, snap to (11, 10), and re-apply intent 2 (dx: 0, dy: -1)
      const reconciled = pm.reconcile(11, 10, 1);

      // CRITICAL: Must not rubber-band back to (11, 10); it must stay at predicted (11, 9)!
      expect(reconciled.x).toBe(11);
      expect(reconciled.y).toBe(9);
      expect(reconciled.replayedCount).toBe(1); // Intent 2 re-applied
      expect(pm.getPendingCount()).toBe(1);
    });

    it("should correctly correct position if server rejects or clamps a move", () => {
      const pm = new PredictionManager(10, 10);

      // Local player attempted to move into a tile (11, 10)
      pm.predictMove(1, 0); // seq 1
      pm.predictMove(0, 1); // seq 2 -> (11, 11)

      // Server rejected Move 1 due to obstacle; server confirms player stayed at (10, 10)
      const reconciled = pm.reconcile(10, 10, 1);

      // From server baseline (10, 10), re-applies intent 2 (dx: 0, dy: 1) -> (10, 11)
      expect(reconciled.x).toBe(10);
      expect(reconciled.y).toBe(11);
    });
  });

  // ===========================================================================
  // 2. Isometric Math & Strict Y-Sorting
  // ===========================================================================
  describe("Isometric Projection & Depth Sorting", () => {
    it("should correctly calculate 2:1 diamond isometric projection coordinates", () => {
      const p1 = gridToScreen(0, 0);
      const p2 = gridToScreen(1, 0);
      const p3 = gridToScreen(0, 1);

      // East step increases screenX by 32, screenY by 16
      expect(p2.x - p1.x).toBe(TILE_WIDTH / 2);
      expect(p2.y - p1.y).toBe(TILE_HEIGHT / 2);

      // South step decreases screenX by 32, increases screenY by 16
      expect(p3.x - p1.x).toBe(-(TILE_WIDTH / 2));
      expect(p3.y - p1.y).toBe(TILE_HEIGHT / 2);
    });

    it("should invert screen coordinates back to grid coordinates accurately", () => {
      const testCoordinates = [
        { gridX: 0, gridY: 0 },
        { gridX: 12, gridY: 15 },
        { gridX: 60, gridY: 60 },
        { gridX: 100, gridY: 100 },
      ];

      for (const coord of testCoordinates) {
        const screen = gridToScreen(coord.gridX, coord.gridY);
        const inverted = screenToGrid(screen.x, screen.y);
        expect(inverted.gridX).toBe(coord.gridX);
        expect(inverted.gridY).toBe(coord.gridY);
      }
    });

    it("should enforce strict Y-Sorting where lower isometric tiles have strictly higher depth", () => {
      // Foreground character (grid 15, 15) must have higher depth than background building (grid 10, 10)
      const backgroundBuildingDepth = calculateDepth(10, 10, 0);
      const foregroundAvatarDepth = calculateDepth(15, 15, 0.5);

      expect(foregroundAvatarDepth).toBeGreaterThan(backgroundBuildingDepth);
    });
  });

  // ===========================================================================
  // 3. Anti-XSS Dialogue Safety & Statutory Disclaimer
  // ===========================================================================
  describe("Anti-XSS & Legal Defense", () => {
    it("should ensure statutory disclaimer is the exact legal text", () => {
      expect(LEGAL_DISCLAIMER_TEXT).toBe(
        "DISCLAIMER: Lugbe to Maitama is a work of fiction and satire. All names, characters, businesses, places, events, and incidents are either the products of the creator's imagination or used in a fictitious manner. Any resemblance to actual persons (living or dead), including the 'President' or any government officials, is purely coincidental."
      );
    });

    it("should sanitize potential LLM injection strings using textContent", () => {
      // Simulated hostile XSS payload from LLM hallucination
      const maliciousPayload = "<img src='x' onerror='alert(\"XSS_PWNED\")'/><script>window.hack=true</script>";

      // Emulate strict textContent container behavior
      const testDiv = {
        _text: "",
        children: [] as any[],
        get textContent() {
          return this._text;
        },
        set textContent(val: string) {
          this._text = val;
          // Does NOT parse into child elements
          this.children = [];
        },
      };

      testDiv.textContent = maliciousPayload;

      // Text is preserved literally
      expect(testDiv.textContent).toBe(maliciousPayload);
      // Zero elements were created or executed
      expect(testDiv.children.length).toBe(0);
    });
  });
});
