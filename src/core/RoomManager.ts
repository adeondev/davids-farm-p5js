import { Room } from './Room.js';

export class RoomManager {
  private _rooms: Map<string, Room> = new Map();
  private _current: Room | null = null;
  private _currentName: string = '';

  register(name: string, room: Room): this {
    this._rooms.set(name, room);
    return this;
  }

  goTo(name: string): void {
    const next = this._rooms.get(name);

    if (!next) {
      console.error(`[RoomManager] Room "${name}" not found.`);
      return;
    }

    if (this._current) {
      this._current.exit();
    }

    this._current = next;
    this._currentName = name;
    this._current.enter();
  }

  get current(): Room | null {
    return this._current;
  }

  get currentName(): string {
    return this._currentName;
  }

  update(): void {
    this._current?.update();
  }

  draw(): void {
    this._current?.draw();
  }

  keyPressed(): void {
    this._current?.keyPressed();
  }

  keyReleased(): void {
    this._current?.keyReleased();
  }
}
