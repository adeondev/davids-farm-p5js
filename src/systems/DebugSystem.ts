/// <reference types="p5/global" />

export class DebugSystem {
  private visible: boolean = false;
  private padding: number = 10;
  private fontSize: number = 12;

  public toggle(): void {
    this.visible = !this.visible;
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public draw(): void {
    if (!this.visible) return;

    const fps = frameRate().toFixed(0);
    const frameTime = (deltaTime).toFixed(2);
    const textStr = `FPS: ${fps} | FT: ${frameTime}ms`;

    push();
    textAlign(LEFT, BOTTOM);
    textSize(this.fontSize);
    textFont('monospace');

    // Background for better readability
    const textW = textWidth(textStr);
    const textH = this.fontSize;
    fill(0, 150);
    noStroke();
    rect(
      this.padding - 5, 
      height - this.padding - textH - 5, 
      textW + 10, 
      textH + 10,
      4
    );

    // Text
    fill(0, 255, 0); // Neo green for debug feel
    text(textStr, this.padding, height - this.padding);
    pop();
  }
}
