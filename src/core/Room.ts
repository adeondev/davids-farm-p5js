import { Grid } from '../systems/debug/index.js';
import type { GridConfig } from '../systems/debug/index.js';

export interface RoomConfig {
  width: number;
  height: number;
  grid?: GridConfig;
}

export abstract class Room {
  public readonly width: number;
  public readonly height: number;
  private _grid: Grid | null = null;

  constructor(config: RoomConfig) {
    this.width = config.width;
    this.height = config.height;

    if (config.grid) {
      this._grid = new Grid(config.grid);
    }
  }

  get grid(): Grid | null {
    return this._grid;
  }

  abstract enter(): void;
  abstract exit(): void;
  abstract update(): void;
  abstract draw(): void;

  keyPressed(): void {}
  keyReleased(): void {}
}
