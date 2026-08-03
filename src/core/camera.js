import { Vector3, ArcRotateCamera, Tools } from '@babylonjs/core';

/**
 * Third-person camera controller with spring-arm behavior
 * Action-MMO style framing with velocity-aware lag
 */

export class CameraController {
  /** @type {ArcRotateCamera} */
  #camera;
  
  /** @type {import('@babylonjs/core').Scene} */
  #scene;
  
  /** @type {Vector3} */
  #targetPosition = new Vector3(0, 1.7, 0);
  
  /** @type {Vector3} */
  #idealOffset = new Vector3(0, 2.5, -4);
  
  /** @type {number} */
  #currentZoom = 1;
  
  /** @type {number} */
  #minZoom = 0.5;
  
  /** @type {number} */
  #maxZoom = 2.0;
  
  /** @type {number} */
  #zoomSpeed = 0.8;
  
  /** @type {number} */
  #horizontalSensitivity = 0.004;
  
  /** @type {number} */
  #verticalSensitivity = 0.004;
  
  /** @type {number} */
  #targetAlpha = Math.PI / 2;
  
  /** @type {number} */
  #targetBeta = 0.35;
  
  /** @type {boolean} */
  #isMouseDown = false;
  
  /** @type {number} */
  #lastMouseX = 0;
  
  /** @type {number} */
  #lastMouseY = 0;
  
  /**
   * @param {import('@babylonjs/core').Scene} scene
   */
  constructor(scene) {
    this.#scene = scene;
    this.#setupCamera();
    this.#setupInput();
  }
  
  #setupCamera() {
    this.#camera = new ArcRotateCamera(
      'camera',
      this.#targetAlpha,
      this.#targetBeta,
      6,
      this.#targetPosition.clone(),
      this.#scene
    );
    
    // Configure for action-game feel
    this.#camera.lowerRadiusLimit = 3;
    this.#camera.upperRadiusLimit = 12;
    this.#camera.lowerBetaLimit = 0.1;
    this.#camera.upperBetaLimit = 0.8;
    this.#camera.checkCollisions = false;
    this.#camera.attachControl(this.#scene.getEngine().getRenderingCanvas(), false);
    
    // Disable default keyboard navigation
    this.#camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
  }
  
  #setupInput() {
    const canvas = this.#scene.getEngine().getRenderingCanvas();
    
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.#isMouseDown = true;
        this.#lastMouseX = e.clientX;
        this.#lastMouseY = e.clientY;
        canvas.requestPointerLock();
      }
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!this.#isMouseDown) return;
      
      const deltaX = e.movementX || (e.clientX - this.#lastMouseX);
      const deltaY = e.movementY || (e.clientY - this.#lastMouseY);
      
      this.#lastMouseX = e.clientX;
      this.#lastMouseY = e.clientY;
      
      this.#targetAlpha -= deltaX * this.#horizontalSensitivity;
      this.#targetBeta += deltaY * this.#verticalSensitivity;
      this.#targetBeta = Math.max(0.1, Math.min(0.8, this.#targetBeta));
    });
    
    document.addEventListener('mouseup', () => {
      this.#isMouseDown = false;
      document.exitPointerLock();
    });
    
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.5 : -0.5;
      this.#currentZoom = Math.max(
        this.#minZoom,
        Math.min(this.#maxZoom, this.#currentZoom + delta * 0.2)
      );
    }, { passive: false });
  }
  
  /**
   * Update camera with spring-arm behavior
   * @param {Vector3} playerPosition
   * @param {number} deltaTime
   * @param {number} speedFactor - 0-1 based on player speed
   */
  update(playerPosition, deltaTime, speedFactor = 0) {
    // Smooth target position follow
    this.#targetPosition.x = Tools.Lerp(
      this.#targetPosition.x,
      playerPosition.x,
      deltaTime * 8
    );
    this.#targetPosition.z = Tools.Lerp(
      this.#targetPosition.z,
      playerPosition.z,
      deltaTime * 8
    );
    this.#targetPosition.y = Tools.Lerp(
      this.#targetPosition.y,
      playerPosition.y + 1.7,
      deltaTime * 8
    );
    
    // Dynamic FOV based on speed
    const baseFOV = 70;
    const maxFOV = 90;
    const targetFOV = baseFOV + (maxFOV - baseFOV) * speedFactor;
    this.#camera.fov = Tools.Lerp(this.#camera.fov, targetFOV * (Math.PI / 180), deltaTime * 3);
    
    // Smooth alpha/beta interpolation
    this.#camera.alpha = Tools.Lerp(this.#camera.alpha, this.#targetAlpha, deltaTime * 5);
    this.#camera.beta = Tools.Lerp(this.#camera.beta, this.#targetBeta, deltaTime * 5);
    
    // Smooth zoom with speed-based widening
    const targetRadius = 6 * this.#currentZoom * (1 + speedFactor * 0.3);
    this.#camera.radius = Tools.Lerp(this.#camera.radius, targetRadius, deltaTime * 4);
    
    // Update camera target
    this.#camera.target = this.#targetPosition.clone();
  }
  
  /**
   * Get the camera's forward direction (for movement input)
   * @returns {Vector3}
   */
  getForwardDirection() {
    const forward = this.#camera.getForwardRay().direction.clone();
    forward.y = 0;
    forward.normalize();
    return forward;
  }
  
  /**
   * Get the camera's right direction
   * @returns {Vector3}
   */
  getRightDirection() {
    const right = this.#camera.getRightRay().direction.clone();
    right.y = 0;
    right.normalize();
    return right;
  }
  
  /**
   * Get the camera instance
   * @returns {ArcRotateCamera}
   */
  getCamera() {
    return this.#camera;
  }
  
  /**
   * Add subtle shake effect (for heavy spells/surf carves)
   * @param {number} intensity 0-1
   * @param {number} duration seconds
   */
  addShake(intensity, duration) {
    // Implemented via post-process or direct camera offset
    // For now, simplified version
    const startTime = Date.now();
    const shakeInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed >= duration) {
        clearInterval(shakeInterval);
        this.#camera.position.addInPlace(this.#camera.position.subtract(this.#camera.target).normalize().scale(-0.01));
        return;
      }
      
      const t = elapsed / duration;
      const decay = 1 - t;
      const offset = intensity * decay * 0.05;
      
      this.#camera.position.x += (Math.random() - 0.5) * offset;
      this.#camera.position.y += (Math.random() - 0.5) * offset;
      this.#camera.position.z += (Math.random() - 0.5) * offset;
    }, 16);
  }
}
