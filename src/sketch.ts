/// <reference types="p5/global" />

import { Game } from './core/index.js';
import { TestRoom } from './rooms/index.js';

(window as any).setup = function() {
  createCanvas(Game.viewport.w, Game.viewport.h);
  frameRate(1000);

  Game.rooms.register('test', new TestRoom());
  Game.rooms.goTo('test');
};

(window as any).draw = function() {
  background(255);

  Game.rooms.update();
  Game.rooms.draw();

  Game.debug.draw();
};

(window as any).keyPressed = function() {
  // F3 Key (keyCode 114)
  if (keyCode === 114) {
    Game.debug.toggle();
    return false; // Prevent default browser behavior
  }

  Game.rooms.keyPressed();
};

(window as any).keyReleased = function() {
  Game.rooms.keyReleased();
};
