// Stage 1 placeholder. Draws where everything will go in the chosen layout,
// and lists incoming chat commands so you can check the server -> game link.
// Replaced by the real game in stage 2.
import Phaser from 'phaser';
import type { Layout, Rect } from '../layout.ts';
import type { Net } from '../net.ts';
import { THEME } from '../theme.ts';

export class PreviewScene extends Phaser.Scene {
  private feedLines: string[] = [];
  private feedText!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private layout: Layout;
  private net: Net;

  constructor(layout: Layout, net: Net) {
    super('preview');
    this.layout = layout;
    this.net = net;
  }

  create(): void {
    const L = this.layout;
    const g = this.add.graphics();

    // Arena
    g.fillStyle(THEME.floor).fillCircle(L.arena.x, L.arena.y, L.arena.radius);
    g.lineStyle(14, THEME.edge).strokeCircle(L.arena.x, L.arena.y, L.arena.radius);

    // Panels
    this.panel(g, L.hud);
    this.panel(g, L.leaderboard);
    this.panel(g, L.feed);
    g.fillStyle(THEME.accent).fillRoundedRect(L.joinBanner.x, L.joinBanner.y, L.joinBanner.w, L.joinBanner.h, 20);

    const big = { fontFamily: THEME.font, color: THEME.text };
    this.add
      .text(L.joinBanner.x + L.joinBanner.w / 2, L.joinBanner.y + L.joinBanner.h / 2, 'Type !join to play', { ...big, fontSize: '54px' })
      .setOrigin(0.5);
    this.add.text(L.hud.x + 24, L.hud.y + 16, 'ROUND 1', { ...big, fontSize: '44px', color: THEME.textAccent });
    this.add.text(L.hud.x + 24, L.hud.y + 70, '0:45', { ...big, fontSize: L.name === 'vertical' ? '80px' : '110px' });
    this.add.text(L.leaderboard.x + 24, L.leaderboard.y + 16, 'ALL-TIME WINS', { ...big, fontSize: '36px', color: THEME.textAccent });
    this.add.text(L.arena.x, L.arena.y, `Name Royale\n${L.name} ${L.width}x${L.height}`, { ...big, fontSize: '56px', align: 'center' }).setOrigin(0.5);

    this.feedText = this.add.text(L.feed.x + 20, L.feed.y + 16, '', {
      fontFamily: THEME.font,
      fontSize: '26px',
      color: THEME.textDim,
      wordWrap: { width: L.feed.w - 40 },
    });
    this.status = this.add.text(L.width - 20, L.height - 16, '', { fontFamily: THEME.font, fontSize: '22px' }).setOrigin(1, 1);

    this.net.onState((state) => {
      this.status.setText(state === 'open' ? '● server connected' : '● waiting for server…');
      this.status.setColor(state === 'open' ? '#3df2b0' : '#ff4f8b');
    });
    this.net.onMessage((msg) => {
      if (msg.type === 'hello') this.log(`connected (chat: ${msg.source})`);
      else if (msg.type === 'command') {
        const c = msg.command;
        this.log(`${msg.viewer.name}: !${c.kind}${c.kind === 'colour' ? ' ' + c.colour : ''}`);
      } else if (msg.type === 'paid') this.log(`💛 ${msg.event.kind} from ${msg.event.viewer.name}`);
    });
  }

  private panel(g: Phaser.GameObjects.Graphics, r: Rect): void {
    g.fillStyle(THEME.panel, 0.85).fillRoundedRect(r.x, r.y, r.w, r.h, 20);
  }

  private log(line: string): void {
    const max = this.layout.name === 'vertical' ? 1 : 20;
    this.feedLines = [line, ...this.feedLines].slice(0, max);
    this.feedText.setText(this.feedLines.join('\n'));
  }
}
