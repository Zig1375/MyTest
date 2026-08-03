/**
 * Spell System - Five spells with continuous, momentum-carrying flow.
 * All spells write to the terrain deformation buffer.
 * 
 * 1: Sweep - Crescent wave of slush/water
 * 2: Ribbon - Held stream tracking camera aim
 * 3: Bloom - Targeted eruption with fallout
 * 4: Crystallize - Ice crystal growth
 * 5: Vortex - Swirling column of airborne snow
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';

// Pre-allocated scratch vectors
const _scratchV3A = new Vector3();
const _scratchV3B = new Vector3();

const SPELL_CONFIG = {
    sweep: {
        duration: 1.5,
        width: 3.0,
        depth: 0.15,
        speed: 8.0,
        particleCount: 200
    },
    ribbon: {
        maxDuration: 5.0,
        width: 0.3,
        particleCount: 100
    },
    bloom: {
        duration: 3.0,
        radius: 4.0,
        height: 6.0,
        particleCount: 500
    },
    crystallize: {
        growTime: 2.0,
        crystalCount: 15,
        maxHeight: 2.0
    },
    vortex: {
        duration: 4.0,
        radius: 3.0,
        height: 8.0,
        particleCount: 800
    }
};

export class SpellSystem {
    constructor(scene, terrain, deformationBuffer, camera) {
        this.scene = scene;
        this.terrain = terrain;
        this.deformationBuffer = deformationBuffer;
        this.camera = camera;
        
        // Active spell state
        this.activeSpell = null;
        this.spellStartTime = 0;
        this.spellTarget = null;
        
        // Particle systems (pooled)
        this.particlePools = {};
        this._initParticlePools();
        
        // Spell meshes
        this.spellMeshes = [];
        
        // Input handling
        this._setupInputs();
    }
    
    _initParticlePools() {
        // Initialize particle pools for each spell type
        const types = ['sweep', 'ribbon', 'bloom', 'vortex'];
        for (const type of types) {
            const config = SPELL_CONFIG[type];
            this.particlePools[type] = {
                particles: [],
                active: [],
                maxCount: config.particleCount || 500
            };
            
            // Pre-allocate particles
            for (let i = 0; i < config.particleCount; i++) {
                this.particlePools[type].particles.push({
                    position: new Vector3(0, 0, 0),
                    velocity: new Vector3(0, 0, 0),
                    lifetime: 0,
                    age: 0,
                    size: 0,
                    color: new Color3(1, 1, 1),
                    active: false
                });
            }
        }
    }
    
    _setupInputs() {
        this.keys = {};
        
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Digit1') this._castSpell('sweep');
            if (e.code === 'Digit2') this._castSpell('ribbon');
            if (e.code === 'Digit3') this._castSpell('bloom');
            if (e.code === 'Digit4') this._castSpell('crystallize');
            if (e.code === 'Digit5') this._castSpell('vortex');
        });
        
        window.addEventListener('keyup', (e) => {
            if (e.code === 'Digit2') this._endSpell('ribbon');
        });
    }
    
    _castSpell(spellType) {
        if (this.activeSpell && this.activeSpell.type === 'ribbon') {
            // Can't cast while holding ribbon
            return;
        }
        
        const config = SPELL_CONFIG[spellType];
        if (!config) return;
        
        // Get cast target from camera
        const castOrigin = this.camera.position.clone();
        const castDirection = this.camera.getForward();
        
        // Raycast to terrain for ground target
        const groundY = this.terrain.getHeightAt(castOrigin.x, castOrigin.z);
        const t = (groundY - castOrigin.y) / castDirection.y;
        const targetPos = castOrigin.add(castDirection.scale(t));
        
        this.activeSpell = {
            type: spellType,
            startTime: this.scene.totalTime / 1000,
            target: targetPos,
            origin: this.camera.position.clone(),
            direction: castDirection.clone(),
            state: 'casting'
        };
        
        this.spellStartTime = this.activeSpell.startTime;
        this.spellTarget = targetPos;
        
        // Trigger initial deformation based on spell type
        this._applySpellDeformation(spellType, targetPos);
    }
    
    _endSpell(spellType) {
        if (this.activeSpell && this.activeSpell.type === spellType) {
            this.activeSpell = null;
        }
    }
    
    _applySpellDeformation(spellType, position) {
        const config = SPELL_CONFIG[spellType];
        
        switch (spellType) {
            case 'sweep':
                // Crescent channel with berms
                this.deformationBuffer.applySpellDeform(
                    position, config.width, -config.depth, config.depth * 0.5, 0.3, 0
                );
                break;
                
            case 'ribbon':
                // Thin scoring line
                this.deformationBuffer.applySpellDeform(
                    position, config.width * 0.3, -0.05, 0.02, 0.5, 0
                );
                break;
                
            case 'bloom':
                // Crater with raised rim
                this.deformationBuffer.applySpellDeform(
                    position, config.radius, -0.3, 0.4, 0, 0
                );
                break;
                
            case 'crystallize':
                // Ice formation
                this.deformationBuffer.applySpellDeform(
                    position, config.growTime, -0.1, 0.1, 0.2, 1.0
                );
                break;
                
            case 'vortex':
                // Ring thinning
                this.deformationBuffer.applySpellDeform(
                    position, config.radius, -0.2, 0.1, 0, 0
                );
                break;
        }
    }
    
    /**
     * Update all active spells
     */
    update(deltaTime) {
        if (!this.activeSpell) return;
        
        const elapsed = this.scene.totalTime / 1000 - this.spellStartTime;
        const config = SPELL_CONFIG[this.activeSpell.type];
        
        switch (this.activeSpell.type) {
            case 'sweep':
                this._updateSweep(elapsed, deltaTime, config);
                break;
                
            case 'ribbon':
                this._updateRibbon(elapsed, deltaTime, config);
                break;
                
            case 'bloom':
                this._updateBloom(elapsed, deltaTime, config);
                break;
                
            case 'crystallize':
                this._updateCrystallize(elapsed, deltaTime, config);
                break;
                
            case 'vortex':
                this._updateVortex(elapsed, deltaTime, config);
                break;
        }
        
        // Check spell end conditions
        if (elapsed > config.duration && this.activeSpell.type !== 'ribbon') {
            this.activeSpell = null;
        }
    }
    
    _updateSweep(elapsed, deltaTime, config) {
        // Move crescent wave outward from cast origin
        const progress = elapsed / config.duration;
        const distance = progress * config.speed * config.duration;
        
        const wavePos = _scratchV3A.copyFrom(this.activeSpell.origin)
            .add(this.activeSpell.direction.scale(distance));
        
        // Update particles along the wave front
        this._emitParticles('sweep', wavePos, deltaTime);
        
        // Continuous deformation along path
        this.deformationBuffer.applySpellDeform(
            wavePos, config.width * 0.5, -config.depth * 0.3, config.depth * 0.2, 0.2, 0
        );
    }
    
    _updateRibbon(elapsed, deltaTime, config) {
        // Ribbon follows camera aim continuously
        const groundY = this.terrain.getHeightAt(
            this.camera.position.x + this.camera.getForward().x * 10,
            this.camera.position.z + this.camera.getForward().z * 10
        );
        
        const ribbonEnd = _scratchV3A.set(
            this.camera.position.x + this.camera.getForward().x * 10,
            groundY,
            this.camera.position.z + this.camera.getForward().z * 10
        );
        
        // Emit particles along ribbon path
        this._emitParticles('ribbon', ribbonEnd, deltaTime);
        
        // Score continuous line in terrain
        this.deformationBuffer.applySpellDeform(
            ribbonEnd, config.width * 0.3, -0.03, 0.01, 0.4, 0
        );
    }
    
    _updateBloom(elapsed, deltaTime, config) {
        const progress = elapsed / config.duration;
        
        if (progress < 0.3) {
            // Eruption phase
            const eruptionProgress = progress / 0.3;
            const particleHeight = eruptionProgress * config.height;
            
            this._emitParticles('bloom', 
                _scratchV3A.set(this.spellTarget.x, this.spellTarget.y + particleHeight, this.spellTarget.z),
                deltaTime,
                { upwardBias: 1.0 }
            );
        } else if (progress < 1.0) {
            // Fallout phase
            const falloutProgress = (progress - 0.3) / 0.7;
            
            this._emitParticles('bloom',
                _scratchV3A.set(this.spellTarget.x, this.spellTarget.y + config.height * (1 - falloutProgress), this.spellTarget.z),
                deltaTime,
                { downwardBias: 1.0, spread: 0.5 }
            );
        }
    }
    
    _updateCrystallize(elapsed, deltaTime, config) {
        const progress = Math.min(elapsed / config.growTime, 1.0);
        
        // Grow crystals progressively
        const crystalHeight = progress * config.maxHeight;
        
        // Create/update crystal meshes
        if (progress < 1.0) {
            this._growCrystals(crystalHeight);
        }
    }
    
    _updateVortex(elapsed, deltaTime, config) {
        const progress = elapsed / config.duration;
        const rotation = elapsed * 3.0; // Radians per second
        
        // Spawn particles in swirling pattern
        for (let i = 0; i < 5; i++) {
            const angle = rotation + (i / 5) * Math.PI * 2;
            const radius = config.radius * (0.3 + Math.random() * 0.7);
            
            const pos = _scratchV3A.set(
                this.activeSpell.target.x + Math.cos(angle) * radius,
                this.activeSpell.target.y + Math.random() * config.height,
                this.activeSpell.target.z + Math.sin(angle) * radius
            );
            
            this._spawnParticle('vortex', pos, new Vector3(
                -Math.sin(angle) * 2,
                1 + Math.random() * 2,
                Math.cos(angle) * 2
            ));
        }
        
        // Thinning effect on terrain
        const thinRadius = config.radius * (1 - progress * 0.3);
        this.deformationBuffer.applySpellDeform(
            this.activeSpell.target, thinRadius, -0.1 * progress, 0.05 * progress, 0, 0
        );
    }
    
    _emitParticles(type, position, deltaTime, options = {}) {
        const pool = this.particlePools[type];
        const spawnRate = 50; // Particles per second
        
        for (let i = 0; i < spawnRate * deltaTime; i++) {
            const particle = this._getInactiveParticle(pool);
            if (!particle) break;
            
            particle.position.copyFrom(position);
            particle.age = 0;
            particle.lifetime = 0.5 + Math.random() * 1.0;
            particle.active = true;
            
            // Velocity based on options
            if (options.upwardBias) {
                particle.velocity.set(
                    (Math.random() - 0.5) * 2,
                    3 + Math.random() * 3,
                    (Math.random() - 0.5) * 2
                );
            } else if (options.downwardBias) {
                const spread = options.spread || 0.3;
                particle.velocity.set(
                    (Math.random() - 0.5) * spread * 5,
                    -2 - Math.random() * 2,
                    (Math.random() - 0.5) * spread * 5
                );
            } else {
                particle.velocity.set(
                    (Math.random() - 0.5) * 4,
                    1 + Math.random() * 2,
                    (Math.random() - 0.5) * 4
                );
            }
            
            particle.size = 0.05 + Math.random() * 0.1;
        }
        
        // Update existing particles
        for (const particle of pool.particles) {
            if (!particle.active) continue;
            
            particle.age += deltaTime;
            if (particle.age >= particle.lifetime) {
                particle.active = false;
                continue;
            }
            
            particle.position.addInPlace(particle.velocity.scale(deltaTime));
            particle.velocity.y -= 9.8 * deltaTime; // Gravity
            
            // Ground collision
            const groundY = this.terrain.getHeightAt(particle.position.x, particle.position.z);
            if (particle.position.y < groundY) {
                particle.position.y = groundY;
                particle.velocity.y *= -0.3; // Bounce
                particle.velocity.x *= 0.5;
                particle.velocity.z *= 0.5;
            }
        }
    }
    
    _spawnParticle(type, position, velocity) {
        const pool = this.particlePools[type];
        const particle = this._getInactiveParticle(pool);
        
        if (particle) {
            particle.position.copyFrom(position);
            particle.velocity.copyFrom(velocity);
            particle.age = 0;
            particle.lifetime = 1.0 + Math.random() * 1.5;
            particle.size = 0.08 + Math.random() * 0.12;
            particle.active = true;
        }
    }
    
    _getInactiveParticle(pool) {
        for (const particle of pool.particles) {
            if (!particle.active) return particle;
        }
        return null; // Pool exhausted
    }
    
    _growCrystals(height) {
        // Placeholder for crystal mesh generation
        // Would create/refract crystal formations growing from terrain
    }
    
    dispose() {
        for (const mesh of this.spellMeshes) {
            mesh.dispose();
        }
        this.spellMeshes = [];
        this.particlePools = {};
    }
}
