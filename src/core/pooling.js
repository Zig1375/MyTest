import { Vector3, Quaternion } from '@babylonjs/core';

/**
 * Pre-allocated scratch vectors to avoid GC allocations in hot paths
 * All vectors are reusable - caller must copy values if persistence needed
 */

// Position/movement scratch vectors
export const SCRATCH_POS_1 = new Vector3(0, 0, 0);
export const SCRATCH_POS_2 = new Vector3(0, 0, 0);
export const SCRATCH_POS_3 = new Vector3(0, 0, 0);

// Direction vectors
export const SCRATCH_DIR_1 = new Vector3(0, 0, 0);
export const SCRATCH_DIR_2 = new Vector3(0, 0, 0);

// Quaternion scratch
export const SCRATCH_QUAT_1 = new Quaternion(0, 0, 0, 1);
export const SCRATCH_QUAT_2 = new Quaternion(0, 0, 0, 1);

/**
 * Simple object pool for reusable objects
 * @template T
 */
export class ObjectPool {
  /** @type {T[]} */
  #available = [];
  
  /** @type {() => T} */
  #factory;
  
  /** @type {(item: T) => void} */
  #resetter;
  
  /**
   * @param {() => T} factory
   * @param {(item: T) => void} [resetter]
   * @param {number} initialSize
   */
  constructor(factory, resetter = null, initialSize = 100) {
    this.#factory = factory;
    this.#resetter = resetter;
    
    // Pre-allocate
    for (let i = 0; i < initialSize; i++) {
      this.#available.push(this.#factory());
    }
  }
  
  /**
   * Get an object from the pool
   * @returns {T}
   */
  acquire() {
    if (this.#available.length > 0) {
      const item = this.#available.pop();
      if (this.#resetter) {
        this.#resetter(item);
      }
      return item;
    }
    return this.#factory();
  }
  
  /**
   * Return an object to the pool
   * @param {T} item
   */
  release(item) {
    if (this.#resetter) {
      this.#resetter(item);
    }
    this.#available.push(item);
  }
  
  /**
   * Get pool statistics
   * @returns {{available: number, total: number}}
   */
  getStats() {
    return {
      available: this.#available.length,
      total: this.#available.length // Could track issued separately
    };
  }
}

/**
 * Create a pool for Vector3 objects
 * @param {number} initialSize
 * @returns {ObjectPool<Vector3>}
 */
export function createVector3Pool(initialSize = 200) {
  return new ObjectPool(
    () => new Vector3(0, 0, 0),
    (v) => { v.x = 0; v.y = 0; v.z = 0; },
    initialSize
  );
}

/**
 * Create a pool for Quaternion objects
 * @param {number} initialSize
 * @returns {ObjectPool<Quaternion>}
 */
export function createQuaternionPool(initialSize = 50) {
  return new ObjectPool(
    () => new Quaternion(0, 0, 0, 1),
    (q) => { q.x = 0; q.y = 0; q.z = 0; q.w = 1; },
    initialSize
  );
}
