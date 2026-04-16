/// <reference types="p5/global" />

import { GameObject } from '../core/GameObject.js';

export class TestBlock extends GameObject {
  public size: number;
  private r: number;
  private g: number;
  private b: number;
  private a: number;

  constructor(x: number, y: number, size: number, r: number, g: number, b: number, a: number = 255) {
    super(x, y);
    this.size = size;
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }

  draw(): void {
    fill(this.r, this.g, this.b, this.a);
    noStroke();
    rect(this.x, this.y, this.size, this.size);
  }
}
