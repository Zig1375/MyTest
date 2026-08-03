import { snowflowEngine } from './core/engine.js';
import { CameraController } from './core/camera.js';
import { perfMonitor } from './core/performance.js';
import { Vector3, MeshBuilder, StandardMaterial, Color3, HemisphericLight, DirectionalLight, ShadowGenerator, PBRMaterial, Texture } from '@babylonjs/core';
import { TerrainNoise } from './terrain/noise.js';
import { TerrainClipmap } from './terrain/terrainClipmap.js';
import { DeformationBuffer } from './terrain/deformationBuffer.js';
import { CharacterController } from './character/characterController.js';
import { SpellSystem } from './spells/spellSystem.js';
import { SnowSurfSystem } from './vfx/snowSurf.js';

/**
 * Main entry point for SNOWFLOW tech demo
 */

async function main() {
  // Update loading text
  const loadingText = document.getElementById('loadingText');
  const loadingProgress = document.getElementById('loadingProgress');
  
  loadingText.textContent = 'Initializing WebGPU...';
  loadingProgress.style.width = '10%';
  
  // Initialize engine
  const success = await snowflowEngine.initialize();
  if (!success) return;
  
  loadingProgress.style.width = '25%';
  loadingText.textContent = 'Loading resources...';
  
  const scene = snowflowEngine.getScene();
  const engine = snowflowEngine.getEngine();
  
  // Initialize performance monitor
  perfMonitor.initialize();
  
  // Create camera controller
  const cameraController = new CameraController(scene);
  
  loadingProgress.style.width = '40%';
  loadingText.textContent = 'Building terrain...';
  
  // Create terrain system with clipmap LOD
  const terrainNoise = new TerrainNoise(12345, Math.PI / 6, 0.5);
  const clipmap = new TerrainClipmap(scene, terrainNoise);
  clipmap.attachToScene();
  
  // Create deformation buffer for persistent footprints/trails
  const deformationBuffer = new DeformationBuffer(scene, engine);
  
  loadingProgress.style.width = '55%';
  loadingText.textContent = 'Setting up lighting...';
  
  // Setup lighting and atmosphere
  setupLighting(scene);
  
  // Create snow material with custom shader
  const snowMaterial = createSnowMaterial(scene, deformationBuffer);
  clipmap.setMaterial(snowMaterial);
  
  loadingProgress.style.width = '70%';
  loadingText.textContent = 'Creating character...';
  
  // Create character controller
  const character = new CharacterController(scene, cameraController.getCamera(), clipmap);
  character.onFootstepCallback = (footPos) => {
    deformationBuffer.applyFootstep(footPos);
  };
  
  // Create spell system
  const spellSystem = new SpellSystem(scene, clipmap, deformationBuffer, cameraController.getCamera());
  
  // Create snow surf system
  const snowSurf = new SnowSurfSystem(scene, clipmap, deformationBuffer, character, cameraController.getCamera());
  
  loadingProgress.style.width = '85%';
  loadingText.textContent = 'Warming pipelines...';
  
  // Warm-up render passes - compile all shaders
  await warmupPipelines(scene, snowMaterial, spellSystem, snowSurf);
  
  loadingProgress.style.width = '100%';
  loadingText.textContent = 'Ready';
  
  // Start render loop
  let lastTime = performance.now();
  
  snowflowEngine.runRenderLoop(() => {
    const currentTime = performance.now();
    const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.05);
    lastTime = currentTime;
    
    // Update systems
    character.update(deltaTime);
    spellSystem.update(deltaTime);
    snowSurf.update(deltaTime);
    
    // Update deformation buffer origin to follow player
    deformationBuffer.updateOrigin(character.position);
    
    // Update clipmap center
    clipmap.updateCenter(character.position);
    
    // Update camera with spring-arm behavior
    cameraController.update(character.position, deltaTime, snowSurf.getState().speed || 0);
    
    // Record frame for performance monitoring
    perfMonitor.recordFrame(currentTime, scene);
  });
  
  // Hide loading screen after brief delay
  setTimeout(() => {
    const loadingScreen = document.getElementById('loadingScreen');
    loadingScreen.classList.add('hidden');
    setTimeout(() => {
      loadingScreen.style.display = 'none';
    }, 800);
  }, 1500);
}

/**
 * Create terrain mesh with procedural heightfield
 * @param {import('@babylonjs/core').Scene} scene
 * @param {TerrainNoise} noise
 * @returns {import('@babylonjs/core').Mesh}
 */
async function createTerrain(scene, noise) {
  const { MeshBuilder } = await import('@babylonjs/core');
  
  // High-resolution terrain for near-field detail
  const width = 200;
  const depth = 200;
  const subdivisions = 256;
  
  const terrain = MeshBuilder.CreateGround(
    'terrain',
    {
      width: width,
      height: depth,
      subdivisions: subdivisions,
      updatable: true
    },
    scene
  );
  
  // Generate vertex heights from noise
  const positions = terrain.getVerticesData('position');
  if (positions) {
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const z = positions[i + 2];
      const height = noise.getHeight(x, z);
      positions[i + 1] = height;
    }
    terrain.updateVerticesData('position', positions, false, false);
    terrain.refreshBoundingInfo();
  }
  
  // Create snow material
  const snowMat = new PBRMaterial('snowMat', scene);
  snowMat.albedoColor = new Color3(0.95, 0.96, 0.98);
  snowMat.specularColor = new Color3(0.15, 0.18, 0.22);
  snowMat.metallic = 0;
  snowMat.roughness = 0.7;
  snowMat.subSurface.isRefractionEnabled = false;
  
  terrain.material = snowMat;
  terrain.receiveShadows = true;
  
  return terrain;
}

/**
 * Create custom snow material with shader
 * @param {import('@babylonjs/core').Scene} scene
 * @param {DeformationBuffer} deformationBuffer
 */
function createSnowMaterial(scene, deformationBuffer) {
  const snowMat = new PBRMaterial('snowMat', scene);
  snowMat.albedoColor = new Color3(0.94, 0.95, 0.97);
  snowMat.specularColor = new Color3(0.12, 0.14, 0.18);
  snowMat.metallic = 0;
  snowMat.roughness = 0.65;
  snowMat.subSurface.isRefractionEnabled = true;
  snowMat.subSurface.tintColor = new Color3(0.85, 0.9, 1.0);
  snowMat.subSurface.tintThickness = 0.5;
  
  // Bind deformation texture when available
  const deformTexture = deformationBuffer.getTexture();
  if (deformTexture) {
    snowMat.setTexture('deformationMap', deformTexture);
  }
  
  return snowMat;
}

/**
 * Setup lighting: low warm sun + blue ambient
 * @param {import('@babylonjs/core').Scene} scene
 */
function setupLighting(scene) {
  // Hemispheric light for blue-shifted ambient
  const hemiLight = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemiLight.intensity = 0.4;
  hemiLight.groundColor = new Color3(0.3, 0.4, 0.6); // Blue shadow
  hemiLight.diffuse = new Color3(0.8, 0.85, 0.95);
  
  // Directional light for sun (low angle for long shadows)
  const sunLight = new DirectionalLight('sun', new Vector3(-0.5, -0.3, -0.8).normalize(), scene);
  sunLight.position = new Vector3(50, 30, 80);
  sunLight.intensity = 1.2;
  sunLight.diffuse = new Color3(1.0, 0.92, 0.8); // Warm sunlight
  sunLight.specular = new Color3(1.0, 0.95, 0.85);
  
  // Cascaded shadow maps
  const shadowGen = new ShadowGenerator(2048, sunLight, true);
  shadowGen.useCascadedShadowMap = true;
  shadowGen.cascades = 4;
  shadowGen.shadowMinZ = 1;
  shadowGen.shadowMaxZ = 150;
  shadowGen.transparencyShadow = true;
  
  // Store for later use
  snowflowEngine.setResource('sunLight', sunLight);
  snowflowEngine.setResource('shadowGen', shadowGen);
}

/**
 * Warm up all shader pipelines before first frame
 * @param {import('@babylonjs/core').Scene} scene
 * @param {any} snowMaterial
 * @param {SpellSystem} spellSystem
 * @param {SnowSurfSystem} snowSurf
 */
async function warmupPipelines(scene, snowMaterial, spellSystem, snowSurf) {
  const engine = scene.getEngine();
  
  // Render frames to warm up pipelines
  for (let i = 0; i < 8; i++) {
    scene.render();
    await engine.flushFramebuffer();
  }
  
  // Force compile spell shaders by triggering brief activations
  // This ensures no hitch on first actual cast
  const spellTypes = ['sweep', 'ribbon', 'bloom', 'crystallize', 'vortex'];
  for (const type of spellTypes) {
    // Simulate brief spell activation
    spellSystem.activeSpell = {
      type: type,
      startTime: scene.totalTime / 1000,
      target: new Vector3(0, 0, -10),
      origin: new Vector3(0, 2, 5),
      direction: new Vector3(0, 0, -1).clone(),
      state: 'casting'
    };
    spellSystem.update(0.016);
    spellSystem.activeSpell = null;
    
    await engine.flushFramebuffer();
  }
}

// Start the demo
main().catch(console.error);
