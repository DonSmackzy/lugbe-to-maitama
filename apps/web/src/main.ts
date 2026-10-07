// =============================================================================
// Web Client Entry Point — apps/web/src/main.ts
// Orchestrates:
// 1. Unbypassable Splash Screen with prominent Satire Disclaimer
// 2. Colyseus Game Client Connection with disclaimer verification payload
// 3. Phaser 3 Isometric Game Canvas (30 FPS cap, camera culling, strict Y-sorting)
// 4. DOM-based GameHUD (pointer-events: none) & Anti-XSS dialogue rendering
// =============================================================================

import "./style.css";
import Phaser from "phaser";
import { renderSplashScreen } from "./ui/SplashScreen.js";
import { ColyseusGameClient } from "./network/ColyseusClient.js";
import { GameHUD } from "./ui/GameHUD.js";
import { MainScene } from "./game/MainScene.js";

const appContainer = document.getElementById("app");
if (!appContainer) {
  throw new Error("Target #app root container not found in DOM");
}

// 1. Render Unbypassable Splash Screen & Onboarding
renderSplashScreen(appContainer, async (credentials) => {
  console.log("[web] Disclaimer acknowledged. Initializing simulation:", credentials);

  // Clear splash and prepare container for Phaser Canvas & DOM HUD
  appContainer.innerHTML = `
    <div id="game-container" style="
      position: relative;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background: #090d16;
    ">
      <div id="phaser-canvas-container" style="width: 100%; height: 100%;"></div>
    </div>
  `;

  const gameRoot = document.getElementById("game-container")!;
  const canvasContainer = document.getElementById("phaser-canvas-container")!;

  // 2. Mount DOM-Based HUD (pointer-events: none container)
  const hud = new GameHUD(gameRoot);

  // 3. Connect to Colyseus Server with verified disclaimer payload (dynamically resolved)
  const colyseusClient = new ColyseusGameClient();

  try {
    await colyseusClient.connect({
      username: credentials.username,
      startingDistrict: credentials.startingDistrict,
      disclaimerAccepted: credentials.disclaimerAccepted,
      disclaimerAcceptedAt: credentials.disclaimerAcceptedAt,
    });
    console.log("[web] Connected to Colyseus authoritative room");
  } catch (err) {
    console.warn(
      "[web] Colyseus server offline or starting up. Running in local simulation mode:",
      err
    );
  }

  // 4. Configure Phaser 3 Game with 30 FPS Cap
  const phaserConfig: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: canvasContainer,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#080c14",
    fps: {
      target: 30,
      forceSetTimeOut: true,
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [MainScene],
  };

  const game = new Phaser.Game(phaserConfig);

  // Pass active dependencies to MainScene
  game.scene.start("MainScene", {
    colyseusClient,
    hud,
    username: credentials.username,
    startingDistrict: credentials.startingDistrict,
  });

  // Handle window resizing
  window.addEventListener("resize", () => {
    game.scale.resize(window.innerWidth, window.innerHeight);
  });
});
