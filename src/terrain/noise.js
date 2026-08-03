import { Vector3, Color3, Tools } from '@babylonjs/core';

/**
 * Multi-octave procedural noise for terrain heightfield
 * Combines broad dunes, medium drifts, and fine sastrugi with wind direction
 */

export class TerrainNoise {
  /** @type {number} */
  #seed;
  
  /** @type {number} */
  #windDirection; // radians
  
  /** @type {number} */
  #windStrength;
  
  // Precomputed permutation table for hash
  /** @type {Uint8Array} */
  #perm;
  
  /** @type {Uint8Array} */
  #perm2;
  
  constructor(seed = 12345, windDirection = Math.PI / 4, windStrength = 0.6) {
    this.#seed = seed;
    this.#windDirection = windDirection;
    this.#windStrength = windStrength;
    this.#generatePermutation();
  }
  
  #generatePermutation() {
    this.#perm = new Uint8Array(512);
    this.#perm2 = new Uint8Array(512);
    
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
    }
    
    // Shuffle based on seed
    let s = this.#seed;
    for (let i = 255; i > 0; i--) {
      s = (s * 16807) % 2147483647;
      const j = s % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    
    for (let i = 0; i < 512; i++) {
      this.#perm[i] = p[i & 255];
      this.#perm2[i] = p[i & 255];
    }
  }
  
  /**
   * Hash function for noise
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  #hash(x, y) {
    const n = x + this.#perm[y & 255] * 57;
    return ((this.#perm[n & 255] * 13) & 255) / 255;
  }
  
  /**
   * Smoothstep interpolation
   * @param {number} t
   * @returns {number}
   */
  #smoothstep(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  
  /**
   * 2D value noise
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  #valueNoise2D(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    
    const tl = this.#hash(X, Y);
    const tr = this.#hash(X + 1, Y);
    const bl = this.#hash(X, Y + 1);
    const br = this.#hash(X + 1, Y + 1);
    
    const u = this.#smoothstep(xf);
    const v = this.#smoothstep(yf);
    
    const top = Tools.Lerp(tl, tr, u);
    const bottom = Tools.Lerp(bl, br, u);
    
    return Tools.Lerp(top, bottom, v);
  }
  
  /**
   * fBm noise with multiple octaves
   * @param {number} x
   * @param {number} y
   * @param {number} octaves
   * @param {number} lacunarity
   * @param {number} gain
   * @returns {number}
   */
  #fbm(x, y, octaves = 6, lacunarity = 2, gain = 0.5) {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let normalization = 0;
    
    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.#valueNoise2D(x * frequency, y * frequency);
      normalization += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    
    return value / normalization;
  }
  
  /**
   * Ridged multifractal noise for sharp features
   * @param {number} x
   * @param {number} y
   * @param {number} octaves
   * @returns {number}
   */
  #ridgedMF(x, y, octaves = 6) {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let normalization = 0;
    
    for (let i = 0; i < octaves; i++) {
      let signal = this.#valueNoise2D(x * frequency, y * frequency);
      signal = 1 - Math.abs(signal * 2 - 1); // Ridge
      signal = signal * signal; // Sharpen
      
      value += amplitude * signal;
      normalization += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    
    return value / normalization;
  }
  
  /**
   * Get terrain height at world position
   * @param {number} wx - world X in meters
   * @param {number} wz - world Z in meters
   * @returns {number} height in meters
   */
  getHeight(wx, wz) {
    // Rotate coordinates by wind direction for anisotropic features
    const cosW = Math.cos(this.#windDirection);
    const sinW = Math.sin(this.#windDirection);
    
    const windX = wx * cosW - wz * sinW;
    const windZ = wx * sinW + wz * cosW;
    
    // Stretch along wind direction
    const stretchedX = windX * (1 + this.#windStrength * 0.5);
    const stretchedZ = windZ;
    
    // Layer 1: Broad dune forms (tens of meters)
    const duneScale = 0.02;
    const duneHeight = 8;
    const dunes = this.#fbm(
      stretchedX * duneScale,
      stretchedZ * duneScale,
      4, 2, 0.5
    ) * duneHeight;
    
    // Layer 2: Medium drifts and wind lobes (meters)
    const driftScale = 0.1;
    const driftHeight = 1.5;
    const drifts = this.#fbm(
      stretchedX * driftScale,
      stretchedZ * driftScale,
      5, 2, 0.5
    ) * driftHeight;
    
    // Layer 3: Sastrugi ridges (decimeters) - anisotropic
    const sastrugiScale = 0.5;
    const sastrugiHeight = 0.15;
    const sastrugi = this.#ridgedMF(
      stretchedX * sastrugiScale,
      stretchedZ * sastrugiScale * 3, // Elongated perpendicular to wind
      4
    ) * sastrugiHeight;
    
    // Layer 4: Fine surface ripples
    const rippleScale = 1.5;
    const rippleHeight = 0.03;
    const ripples = this.#valueNoise2D(
      wx * rippleScale,
      wz * rippleScale
    ) * rippleHeight;
    
    // Combine layers
    let height = dunes + drifts + sastrugi + ripples;
    
    // Add slope-dependent attenuation for realistic accumulation
    // (simplified - full version would compute actual slope)
    return height;
  }
  
  /**
   * Get normal at world position (via central differences)
   * @param {number} wx
   * @param {number} wz
   * @param {number} sampleDist
   * @returns {Vector3} normalized normal
   */
  getNormal(wx, wz, sampleDist = 0.1) {
    const hL = this.getHeight(wx - sampleDist, wz);
    const hR = this.getHeight(wx + sampleDist, wz);
    const hD = this.getHeight(wx, wz - sampleDist);
    const hU = this.getHeight(wx, wz + sampleDist);
    
    const nx = hL - hR;
    const nz = hD - hU;
    const ny = 2 * sampleDist;
    
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    
    return new Vector3(nx / len, ny / len, nz / len);
  }
  
  /**
   * Set wind direction
   * @param {number} radians
   */
  setWindDirection(radians) {
    this.#windDirection = radians;
  }
  
  /**
   * Get wind direction
   * @returns {number}
   */
  getWindDirection() {
    return this.#windDirection;
  }
}
