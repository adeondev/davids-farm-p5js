import { Grid } from '../systems/debug/index.js';
import type { GridConfig } from '../systems/debug/index.js';
import { GameObject } from './GameObject.js';
import { Layer } from './Layer.js';
import type { LayerConfig } from './Layer.js';

export interface RoomConfig {
  width: number;
  height: number;
  grid?: GridConfig;
}

export abstract class Room {
  public readonly width: number;
  public readonly height: number;
  private _grid: Grid | null = null;
  private _layers: Map<string, Layer> = new Map();
  private _sortedLayers: Layer[] = [];
  private _layersDirty: boolean = false;

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

  createLayer(name: string, config: LayerConfig): Layer {
    if (this._layers.has(name)) {
      return this._layers.get(name)!;
    }
    const layer = new Layer(name, config);
    this._layers.set(name, layer);
    this._layersDirty = true;
    return layer;
  }

  getLayer(name: string): Layer | null {
    return this._layers.get(name) ?? null;
  }

  removeLayer(name: string): void {
    const layer = this._layers.get(name);
    if (!layer) return;
    for (const obj of layer.objects) {
      obj.destroy();
    }
    this._layers.delete(name);
    this._layersDirty = true;
  }

  private _resolveLayers(): Layer[] {
    if (this._layersDirty) {
      this._sortedLayers = Array.from(this._layers.values())
        .sort((a, b) => a.depth - b.depth);
      this._layersDirty = false;
    }
    return this._sortedLayers;
  }

  addObject<T extends GameObject>(obj: T, layerName: string): T {
    const layer = this._layers.get(layerName);
    if (!layer) {
      console.error(`[Room] Layer "${layerName}" not found.`);
      return obj;
    }
    obj.layerName = layerName;
    layer.addObject(obj);
    obj.create();
    return obj;
  }

  removeObject(obj: GameObject): void {
    if (obj.destroyed) return;
    obj.destroy();
  }

  moveObject(obj: GameObject, newLayerName: string): void {
    const oldLayer = this._layers.get(obj.layerName);
    const newLayer = this._layers.get(newLayerName);
    if (!newLayer) {
      console.error(`[Room] Layer "${newLayerName}" not found.`);
      return;
    }
    if (oldLayer) oldLayer.removeObject(obj);
    obj.layerName = newLayerName;
    newLayer.addObject(obj);
  }

  findByType<T extends GameObject>(type: new (...args: any[]) => T): T[] {
    const results: T[] = [];
    for (const layer of this._layers.values()) {
      for (const obj of layer.objects) {
        if (!obj.destroyed && obj instanceof type) {
          results.push(obj);
        }
      }
    }
    return results;
  }

  findFirst<T extends GameObject>(type: new (...args: any[]) => T): T | null {
    for (const layer of this._layers.values()) {
      for (const obj of layer.objects) {
        if (!obj.destroyed && obj instanceof type) {
          return obj;
        }
      }
    }
    return null;
  }

  findByTag(tag: string): GameObject[] {
    const results: GameObject[] = [];
    for (const layer of this._layers.values()) {
      for (const obj of layer.objects) {
        if (!obj.destroyed && obj.hasTag(tag)) {
          results.push(obj);
        }
      }
    }
    return results;
  }

  findFirstByTag(tag: string): GameObject | null {
    for (const layer of this._layers.values()) {
      for (const obj of layer.objects) {
        if (!obj.destroyed && obj.hasTag(tag)) {
          return obj;
        }
      }
    }
    return null;
  }

  findById(id: number): GameObject | null {
    for (const layer of this._layers.values()) {
      for (const obj of layer.objects) {
        if (!obj.destroyed && obj.id === id) {
          return obj;
        }
      }
    }
    return null;
  }

  get objectCount(): number {
    let count = 0;
    for (const layer of this._layers.values()) {
      count += layer.count;
    }
    return count;
  }

  get layerCount(): number {
    return this._layers.size;
  }

  protected updateLayers(): void {
    for (const layer of this._resolveLayers()) {
      layer.update();
    }
  }

  protected drawLayers(): void {
    for (const layer of this._resolveLayers()) {
      if (layer.visible) {
        layer.draw();
      }
    }
  }

  protected destroyAllObjects(): void {
    for (const layer of this._layers.values()) {
      for (const obj of layer.objects) {
        obj.destroy();
      }
    }
    this._layers.clear();
    this._sortedLayers.length = 0;
    this._layersDirty = false;
  }

  abstract enter(): void;
  abstract exit(): void;
  abstract update(): void;
  abstract draw(): void;

  keyPressed(): void {}
  keyReleased(): void {}
}
