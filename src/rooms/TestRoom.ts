/// <reference types="p5/global" />

import { Room, Game } from '../core/index.js';
import { Player } from '../entities/index.js';
import { Camera } from '../systems/camera/index.js';

export class TestRoom extends Room {
  private player!: Player;
  private camera!: Camera;

  constructor() {
    super({
      width: 2000,
      height: 2000,
      grid: { cellSize: 32 }
    });
  }

  enter(): void {
    this.player = new Player(this.width / 2, this.height / 2);

    this.camera = new Camera({
      viewport: Game.viewport,
      pixelSnap: false,
      follow: {
        mode: 'lerp',
        lerpSpeed: 6
      }
    });

    this.camera.setTarget(this.player);
    this.camera.setBounds({ x: 0, y: 0, w: this.width, h: this.height });
    this.camera.snapToTarget();
  }

  exit(): void {}

  update(): void {
    this.player.update();
    this.camera.update();
  }

  draw(): void {
    this.camera.apply();

    if (Game.debug.isVisible() && this.grid) {
      this.grid.draw(this.width, this.height);
    }

    this.player.draw();
    this.camera.reset();
  }
}
