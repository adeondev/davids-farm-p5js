/// <reference types="p5/global" />

export interface GridConfig {
  cellSize: number;
  color?: [number, number, number, number];
}

export class Grid {
  private cellSize: number;
  private color: [number, number, number, number];

  constructor(config: GridConfig) {
    this.cellSize = config.cellSize;
    this.color = config.color ?? [0, 0, 0, 40];
  }

  draw(roomWidth: number, roomHeight: number): void {
    push();
    stroke(this.color[0], this.color[1], this.color[2], this.color[3]);
    strokeWeight(0.5);
    noFill();

    for (let x = 0; x <= roomWidth; x += this.cellSize) {
      line(x, 0, x, roomHeight);
    }

    for (let y = 0; y <= roomHeight; y += this.cellSize) {
      line(0, y, roomWidth, y);
    }

    pop();
  }
}
