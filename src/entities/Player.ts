/// <reference types="p5/global" />

import { GameObject } from '../core/GameObject.js';

export class Player extends GameObject {
  public size: number;
  private speed: number;

  constructor(x: number, y: number) {
    super(x, y);
    this.speed = 200;
    this.size = 32;
  }

  update(): void {
    let moveX = 0;
    let moveY = 0;

    if (keyIsDown(LEFT_ARROW) || keyIsDown(65)) moveX -= 1;
    if (keyIsDown(RIGHT_ARROW) || keyIsDown(68)) moveX += 1;
    if (keyIsDown(UP_ARROW) || keyIsDown(87)) moveY -= 1;
    if (keyIsDown(DOWN_ARROW) || keyIsDown(83)) moveY += 1;

    if (moveX !== 0 || moveY !== 0) {
      let length = Math.sqrt(moveX * moveX + moveY * moveY);
      moveX /= length;
      moveY /= length;

      let dt = deltaTime / 1000;
      this.x += moveX * this.speed * dt;
      this.y += moveY * this.speed * dt;
    }
  }

  draw(): void {
    fill(0);
    noStroke();
    rect(this.x, this.y, this.size, this.size);
  }
}
