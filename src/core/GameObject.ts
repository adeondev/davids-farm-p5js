/// <reference types="p5/global" />

export abstract class GameObject {
  private static _nextId: number = 0;

  public readonly id: number;
  public x: number;
  public y: number;
  public active: boolean = true;
  public visible: boolean = true;
  public depth: number = 0;
  public layerName: string = '';
  public destroyed: boolean = false;

  private _tags: Set<string> = new Set();

  constructor(x: number = 0, y: number = 0) {
    this.id = GameObject._nextId++;
    this.x = x;
    this.y = y;
  }

  get tags(): ReadonlySet<string> {
    return this._tags;
  }

  addTag(...tags: string[]): this {
    for (const tag of tags) this._tags.add(tag);
    return this;
  }

  removeTag(tag: string): this {
    this._tags.delete(tag);
    return this;
  }

  hasTag(tag: string): boolean {
    return this._tags.has(tag);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.onDestroy();
    this.destroyed = true;
  }

  create(): void {}
  update(): void {}
  draw(): void {}
  onDestroy(): void {}
}
