import { Engine, Scene, Color4 } from '@babylonjs/core';

/**
 * Core engine bootstrap for SNOWFLOW
 * Handles WebGPU initialization, render loop, and resource management
 */

export class SnowflowEngine {
  /** @type {Engine|null} */
  #engine = null;
  
  /** @type {Scene|null} */
  #scene = null;
  
  /** @type {HTMLCanvasElement|null} */
  #canvas = null;
  
  /** @type {boolean} */
  #isReady = false;
  
  /** @type {Map<string, any>} */
  #resources = new Map();
  
  /** @type {Array<() => void>} */
  #onReadyCallbacks = [];
  
  /**
   * Initialize the engine with WebGPU
   * @returns {Promise<boolean>} success
   */
  async initialize() {
    // Check WebGPU support
    if (!navigator.gpu) {
      document.getElementById('noWebGPU').style.display = 'flex';
      document.getElementById('loadingScreen').style.display = 'none';
      return false;
    }
    
    this.#canvas = document.getElementById('renderCanvas');
    
    try {
      // Initialize WebGPU engine
      this.#engine = await Engine.CreateAsync(this.#canvas, true, {
        antialias: false, // We use TAA
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance'
      });
      
      // Create scene
      this.#scene = new Scene(this.#engine);
      
      // Configure for high quality
      this.#scene.autoClear = true;
      this.#scene.clearColor = new Color4(0.02, 0.02, 0.03, 1);
      
      // Handle resize
      window.addEventListener('resize', () => {
        this.#engine.resize();
      });
      
      this.#isReady = true;
      
      // Notify callbacks
      this.#onReadyCallbacks.forEach(cb => cb());
      
      return true;
    } catch (error) {
      console.error('Failed to initialize WebGPU:', error);
      document.getElementById('noWebGPU').style.display = 'flex';
      document.getElementById('loadingScreen').style.display = 'none';
      return false;
    }
  }
  
  /**
   * Get the Babylon scene
   * @returns {Scene|null}
   */
  getScene() {
    return this.#scene;
  }
  
  /**
   * Get the engine instance
   * @returns {Engine|null}
   */
  getEngine() {
    return this.#engine;
  }
  
  /**
   * Register a callback for when the engine is ready
   * @param {() => void} callback
   */
  onReady(callback) {
    if (this.#isReady) {
      callback();
    } else {
      this.#onReadyCallbacks.push(callback);
    }
  }
  
  /**
   * Store a resource
   * @param {string} key
   * @param {any} resource
   */
  setResource(key, resource) {
    this.#resources.set(key, resource);
  }
  
  /**
   * Get a stored resource
   * @param {string} key
   * @returns {any|undefined}
   */
  getResource(key) {
    return this.#resources.get(key);
  }
  
  /**
   * Run the render loop
   * @param {() => void} renderFunction
   */
  runRenderLoop(renderFunction) {
    if (!this.#engine || !this.#scene) return;
    
    this.#engine.runRenderLoop(() => {
      renderFunction();
      this.#scene.render();
    });
  }
}

// Export singleton instance
export const snowflowEngine = new SnowflowEngine();
