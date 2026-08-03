import { Vector3, Color4, Tools } from '@babylonjs/core';

/**
 * Performance monitoring and frame-time graph overlay
 * Tracks FPS, 1% lows, draw calls, and triangle counts
 */

export class PerformanceMonitor {
  /** @type {number} */
  #frameCount = 0;
  
  /** @type {number} */
  #lastTime = 0;
  
  /** @type {number[]} */
  #frameTimes = [];
  
  /** @type {number} */
  #maxFrameTimeSamples = 120;
  
  /** @type {number} */
  #currentFPS = 0;
  
  /** @type {number} */
  #onePercentLow = 0;
  
  /** @type {HTMLDivElement|null} */
  #overlay = null;
  
  /** @type {HTMLCanvasElement|null} */
  #graphCanvas = null;
  
  /** @type {CanvasRenderingContext2D|null} */
  #ctx = null;
  
  /** @type {boolean} */
  #isVisible = false;
  
  /** @type {number} */
  #updateInterval = 100; // ms
  
  /** @type {number} */
  #lastUpdateTime = 0;
  
  constructor() {
    this.#frameTimes = new Array(this.#maxFrameTimeSamples).fill(0);
  }
  
  /**
   * Initialize the performance overlay
   */
  initialize() {
    // Create overlay container
    this.#overlay = document.createElement('div');
    this.#overlay.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(10, 10, 15, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      padding: 12px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 11px;
      color: #e8f1f8;
      z-index: 999;
      display: none;
      backdrop-filter: blur(8px);
      min-width: 220px;
    `;
    
    // Stats text
    const statsDiv = document.createElement('div');
    statsDiv.id = 'perfStats';
    statsDiv.style.marginBottom = '10px';
    statsDiv.innerHTML = `
      <div>FPS: <span id="fpsValue">--</span></div>
      <div>1% Low: <span id="lowValue">--</span></div>
      <div>Draw Calls: <span id="drawCallsValue">--</span></div>
      <div>Triangles: <span id="trisValue">--</span></div>
    `;
    this.#overlay.appendChild(statsDiv);
    
    // Frame time graph
    this.#graphCanvas = document.createElement('canvas');
    this.#graphCanvas.width = 200;
    this.#graphCanvas.height = 60;
    this.#graphCanvas.style.cssText = `
      width: 200px;
      height: 60px;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 4px;
    `;
    this.#overlay.appendChild(this.#graphCanvas);
    
    this.#ctx = this.#graphCanvas.getContext('2d');
    
    document.body.appendChild(this.#overlay);
    
    // Toggle with F1 or backtick
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F1' || e.key === '`' || e.key === '~') {
        e.preventDefault();
        this.toggle();
      }
    });
  }
  
  /**
   * Toggle overlay visibility
   */
  toggle() {
    this.#isVisible = !this.#isVisible;
    this.#overlay.style.display = this.#isVisible ? 'block' : 'none';
  }
  
  /**
   * Record a frame
   * @param {number} currentTime - performance.now()
   * @param {import('@babylonjs/core').Scene} scene
   */
  recordFrame(currentTime, scene) {
    if (this.#lastTime === 0) {
      this.#lastTime = currentTime;
      return;
    }
    
    const deltaTime = currentTime - this.#lastTime;
    this.#lastTime = currentTime;
    
    // Store frame time
    this.#frameTimes.shift();
    this.#frameTimes.push(deltaTime);
    
    // Calculate FPS
    this.#frameCount++;
    
    // Update stats at interval
    if (currentTime - this.#lastUpdateTime > this.#updateInterval) {
      this.#updateStats(scene, currentTime);
      this.#lastUpdateTime = currentTime;
    }
  }
  
  /**
   * Update displayed statistics
   * @param {import('@babylonjs/core').Scene} scene
   * @param {number} currentTime
   */
  #updateStats(scene, currentTime) {
    // Calculate average FPS
    const totalFrameTime = this.#frameTimes.reduce((a, b) => a + b, 0);
    const avgFrameTime = totalFrameTime / this.#frameTimes.length;
    this.#currentFPS = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
    
    // Calculate 1% low (sort frame times, take top 1%, get worst)
    const sortedTimes = [...this.#frameTimes].sort((a, b) => b - a);
    const onePercentIndex = Math.max(0, Math.floor(sortedTimes.length * 0.01) - 1);
    const worstFrameTime = sortedTimes[onePercentIndex] || avgFrameTime;
    this.#onePercentLow = worstFrameTime > 0 ? 1000 / worstFrameTime : 0;
    
    // Get scene stats
    const drawCalls = scene ? scene.getActiveIndices() : 0;
    const triangles = scene ? Math.floor(scene.getActiveIndices() / 3) : 0;
    
    // Update DOM
    const fpsEl = document.getElementById('fpsValue');
    const lowEl = document.getElementById('lowValue');
    const drawCallsEl = document.getElementById('drawCallsValue');
    const trisEl = document.getElementById('trisValue');
    
    if (fpsEl) fpsEl.textContent = this.#currentFPS.toFixed(0);
    if (lowEl) lowEl.textContent = this.#onePercentLow.toFixed(0);
    if (drawCallsEl) drawCallsEl.textContent = drawCalls.toLocaleString();
    if (trisEl) trisEl.textContent = triangles.toLocaleString();
    
    // Color-code FPS
    if (fpsEl) {
      if (this.#currentFPS >= 90) {
        fpsEl.style.color = '#4ade80';
      } else if (this.#currentFPS >= 60) {
        fpsEl.style.color = '#fbbf24';
      } else {
        fpsEl.style.color = '#f87171';
      }
    }
    
    // Update graph
    this.#drawGraph();
  }
  
  /**
   * Draw frame-time graph
   */
  #drawGraph() {
    if (!this.#ctx) return;
    
    const ctx = this.#ctx;
    const width = this.#graphCanvas.width;
    const height = this.#graphCanvas.height;
    
    // Clear
    ctx.clearRect(0, 0, width, height);
    
    // Draw target lines (90 FPS = 11.1ms, 60 FPS = 16.67ms)
    const target90Y = height - (11.1 / 33.33) * height;
    const target60Y = height - (16.67 / 33.33) * height;
    
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.3)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, target90Y);
    ctx.lineTo(width, target90Y);
    ctx.stroke();
    
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.3)';
    ctx.beginPath();
    ctx.moveTo(0, target60Y);
    ctx.lineTo(width, target60Y);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Draw frame times
    ctx.strokeStyle = '#a8c7fa';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    
    const barWidth = width / this.#frameTimes.length;
    
    for (let i = 0; i < this.#frameTimes.length; i++) {
      const x = i * barWidth;
      const normalizedTime = Math.min(this.#frameTimes[i] / 33.33, 1); // Cap at 30 FPS
      const y = height - (normalizedTime * height);
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    
    ctx.stroke();
    
    // Fill area under curve
    ctx.fillStyle = 'rgba(168, 199, 250, 0.2)';
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();
  }
  
  /**
   * Get current FPS
   * @returns {number}
   */
  getFPS() {
    return this.#currentFPS;
  }
  
  /**
   * Get 1% low FPS
   * @returns {number}
   */
  getOnePercentLow() {
    return this.#onePercentLow;
  }
  
  /**
   * Get average frame time in ms
   * @returns {number}
   */
  getAverageFrameTime() {
    const total = this.#frameTimes.reduce((a, b) => a + b, 0);
    return total / this.#frameTimes.length;
  }
}

// Export singleton
export const perfMonitor = new PerformanceMonitor();
