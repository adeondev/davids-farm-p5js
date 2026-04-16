/// <reference types="p5/global" />
import { Player } from './entities/Player.js';
import { Camera } from './systems/camera/index.js';

import { DebugSystem } from './systems/DebugSystem.js';

let player: Player;
let cam: Camera;
let debug: DebugSystem;

(window as any).setup = function() {
  createCanvas(800, 600);
  frameRate(1000);
  
  player = new Player(width / 2, height / 2);
  debug = new DebugSystem();
  
  cam = new Camera({
    viewport: { w: 800, h: 600 },
    pixelSnap: false,
    follow: {
      mode: 'lerp',
      lerpSpeed: 6
    }
  });

  cam.setTarget(player);
  cam.snapToTarget();
};

(window as any).draw = function() {
  background(255);

  player.update();
  cam.update();

  cam.apply();
  player.draw();
  cam.reset();

  debug.draw();
};

(window as any).keyPressed = function() {
  // F3 Key (keyCode 114)
  if (keyCode === 114) {
    debug.toggle();
    return false; // Prevent default browser behavior
  }
};
