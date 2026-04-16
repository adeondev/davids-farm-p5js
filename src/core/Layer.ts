import { GameObject } from './GameObject.js';

export interface LayerConfig {
  depth: number;
  visible?: boolean;
}

export class Layer {
  public readonly name: string;
  public readonly depth: number;
  public visible: boolean;

  private _objects: GameObject[] = [];
  private _needsSort: boolean = false;

  constructor(name: string, config: LayerConfig) {
    this.name = name;
    this.depth = config.depth;
    this.visible = config.visible ?? true;
  }

  get objects(): readonly GameObject[] {
    return this._objects;
  }

  get count(): number {
    return this._objects.length;
  }

  addObject(obj: GameObject): void {
    this._objects.push(obj);
    this._needsSort = true;
  }

  removeObject(obj: GameObject): void {
    const idx = this._objects.indexOf(obj);
    if (idx >= 0) this._objects.splice(idx, 1);
  }

  markDirty(): void {
    this._needsSort = true;
  }

  update(): void {
    for (let i = this._objects.length - 1; i >= 0; i--) {
      if (this._objects[i].destroyed) {
        this._objects.splice(i, 1);
      }
    }

    if (this._needsSort) {
      this._objects.sort((a, b) => a.depth - b.depth);
      this._needsSort = false;
    }

    const len = this._objects.length;
    for (let i = 0; i < len; i++) {
      const obj = this._objects[i];
      if (obj.active && !obj.destroyed) {
        obj.update();
      }
    }
  }

  draw(): void {
    for (const obj of this._objects) {
      if (obj.visible && !obj.destroyed) {
        obj.draw();
      }
    }
  }
}
