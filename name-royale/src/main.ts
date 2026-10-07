import Phaser from 'phaser';
import { pickLayout } from './layout.ts';
import { Net } from './net.ts';
import { PreviewScene } from './scenes/PreviewScene.ts';
import { THEME } from './theme.ts';

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
  scene: [new PreviewScene(layout, net)],
});
