import { DebugSystem } from '../systems/debug/index.js';
import { RoomManager } from './RoomManager.js';

interface Viewport {
  w: number;
  h: number;
}

interface GameInstance {
  debug: DebugSystem;
  rooms: RoomManager;
  viewport: Viewport;
}

export const Game: GameInstance = {
  debug: new DebugSystem(),
  rooms: new RoomManager(),
  viewport: { w: 800, h: 600 }
};
