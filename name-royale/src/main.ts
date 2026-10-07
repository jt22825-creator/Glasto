import Phaser from 'phaser';
import { GameScene } from './game/GameScene.ts';
import { pickLayout } from './layout.ts';
import { Net } from './net.ts';
import { THEME } from './theme.ts';

const params = new URLSearchParams(window.location.search);
const layout = pickLayout();
const net = new Net();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: layout.width,
  height: layout.height,
  backgroundColor: THEME.bg,
  // Scale to fit any window while keeping the exact 1920x1080 / 1080x1920 coordinates.
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  // The scene steps the physics itself in fixed 1/60 s steps (see GameScene.update).
  physics: { default: 'matter', matter: { gravity: { x: 0, y: 0 }, debug: params.has('debug'), autoUpdate: false } },
  disableContextMenu: true,
  scene: [new GameScene(layout, net, params.has('quick'))],
});
