/// <reference types="p5/global" />

import { Room, Game } from '../core/index.js';
import { Player } from '../entities/index.js';
import { TestBlock } from '../entities/index.js';
import { Camera } from '../systems/camera/index.js';

export class TestRoom extends Room {
  private camera!: Camera;

  constructor() {
    super({
      width: 2000,
      height: 2000,
      grid: { cellSize: 32 }
    });
  }

  enter(): void {
    this.createLayer('background', { depth: 0 });
    this.createLayer('entities', { depth: 50 });
    this.createLayer('foreground', { depth: 100 });

    for (let i = 0; i < 20; i++) {
      const x = Math.random() * this.width;
      const y = Math.random() * this.height;
      this.addObject(new TestBlock(x, y, 64, 60, 120, 200, 100), 'background');
    }

    const player = this.addObject(new Player(this.width / 2, this.height / 2), 'entities');

    for (let i = 0; i < 10; i++) {
      const x = Math.random() * this.width;
      const y = Math.random() * this.height;
      this.addObject(new TestBlock(x, y, 48, 200, 60, 80, 160), 'foreground');
    }

    this.camera = new Camera({
      viewport: Game.viewport,
      pixelSnap: false,
      follow: {
        mode: 'lerp',
        lerpSpeed: 6
      }
    });

    this.camera.setTarget(player);
    this.camera.setBounds({ x: 0, y: 0, w: this.width, h: this.height });
    this.camera.snapToTarget();
  }

  exit(): void {
    this.destroyAllObjects();
  }

  update(): void {
    this.updateLayers();
    this.camera.update();
  }

  draw(): void {
    this.camera.apply();

    if (Game.debug.isVisible() && this.grid) {
      this.grid.draw(this.width, this.height);
    }

    this.drawLayers();
    this.camera.reset();
  }
}
