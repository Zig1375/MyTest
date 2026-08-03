/**
 * Snow Surf System - Hold RMB to surf on compressed snow crest.
 * Features carving turns, wake generation, and persistent grooves.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Tools } from '@babylonjs/core/Misc/tools.js';

// Pre-allocated scratch vectors
const _scratchV3A = new Vector3();
const _scratchV3B = new Vector3();

const SURF_CONFIG = {
    accelerateRate: 15.0,
    maxSpeed: 25.0,
    decelerateRate: 8.0,
    turnSpeed: 2.5,
    leanFactor: 0.4,
    cameraFOVBase: 75,
    cameraFOVMax: 100,
    wakeParticleRate: 100,
    carveDepth: 0.2,
    carveWidth: 0.5,
    bermHeight: 0.3
};

export class SnowSurfSystem {
    constructor(scene, terrain, deformationBuffer, character, camera) {
        this.scene = scene;
        this.terrain = terrain;
        this.deformationBuffer = deformationBuffer;
        this.character = character;
        this.camera = camera;
        
        // Surf state
        this.isSurfing = false;
        this.surfSpeed = 0;
        this.surfDirection = 0; // Radians
        this.leanAngle = 0;
        this.turnIntensity = 0;
        
        // Wake tracking
        this.wakePoints = [];
        this.maxWakePoints = 200;
        this.lastWakeEmit = 0;
        
        // Input state
        this.mouseDeltaX = 0;
        this.isRMBDown = false;
        
        // Camera FOV storage
        this.baseFOV = camera.alpha || SURF_CONFIG.cameraFOVBase;
        
        this._setupInputs();
    }
    
    _setupInputs() {
        window.addEventListener('mousedown', (e) => {
            if (e.button === 2) { // Right mouse button
                this.isRMBDown = true;
                if (!this.isSurfing && this.character.velocity.length() > 2.0) {
                    this._startSurf();
                }
            }
        });
        
        window.addEventListener('mouseup', (e) => {
            if (e.button === 2) {
                this.isRMBDown = false;
                if (this.isSurfing) {
                    this._endSurf();
                }
            }
        });
        
        window.addEventListener('mousemove', (e) => {
            if (this.isSurfing) {
                this.mouseDeltaX = e.movementX || 0;
            }
        });
        
        // Prevent context menu on RMB
        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }
    
    _startSurf() {
        this.isSurfing = true;
        this.surfSpeed = this.character.velocity.length() * 1.2;
        this.surfDirection = this.character.rotation;
        
        // Initial compression under feet
        const footPos = this.character.position.clone();
        footPos.y = this.terrain.getHeightAt(footPos.x, footPos.z);
        this.deformationBuffer.applySurfCarve(footPos, SURF_CONFIG.carveWidth, SURF_CONFIG.carveDepth * 0.3);
    }
    
    _endSurf() {
        this.isSurfing = false;
        this.surfSpeed = 0;
        this.leanAngle = 0;
        this.turnIntensity = 0;
        
        // Restore camera FOV
        this.camera.lowerBetaLimit = null;
    }
    
    /**
     * Update surf physics and effects
     */
    update(deltaTime) {
        if (!this.isSurfing) {
            // Gradually restore camera FOV when not surfing
            return;
        }
        
        // Acceleration
        if (this.isRMBDown) {
            this.surfSpeed += SURF_CONFIG.accelerateRate * deltaTime;
        } else {
            this.surfSpeed -= SURF_CONFIG.decelerateRate * deltaTime;
        }
        
        this.surfSpeed = Math.max(0, Math.min(this.surfSpeed, SURF_CONFIG.maxSpeed));
        
        // End surf if too slow
        if (this.surfSpeed < 3.0) {
            this._endSurf();
            return;
        }
        
        // Turning based on mouse movement
        const turnInput = -this.mouseDeltaX * 0.002;
        this.turnIntensity = Tools.Clamp(turnInput * SURF_CONFIG.turnSpeed, -1, 1);
        this.surfDirection += this.turnIntensity * deltaTime * (0.5 + this.surfSpeed / SURF_CONFIG.maxSpeed);
        
        // Lean into turns
        const targetLean = this.turnIntensity * SURF_CONFIG.leanFactor;
        this.leanAngle += (targetLean - this.leanAngle) * 10 * deltaTime;
        
        // Update character velocity
        _scratchV3A.set(
            Math.sin(this.surfDirection) * this.surfSpeed,
            this.character.velocity.y,
            Math.cos(this.surfDirection) * this.surfSpeed
        );
        this.character.velocity.copyFrom(_scratchV3A);
        this.character.rotation = this.surfDirection;
        
        // Apply carve deformation continuously
        this._applyCarve(deltaTime);
        
        // Generate wake particles/trail
        this._updateWake(deltaTime);
        
        // Camera effects
        this._updateCameraEffects(deltaTime);
        
        // Reset mouse delta for next frame
        this.mouseDeltaX = 0;
    }
    
    _applyCarve(deltaTime) {
        const carveInterval = 0.05; // Apply carve every 50ms
        
        if (this.scene.totalTime / 1000 - this.lastWakeEmit > carveInterval) {
            const carvePos = this.character.position.clone();
            carvePos.y = this.terrain.getHeightAt(carvePos.x, carvePos.z);
            
            // Deep groove in center
            const depth = SURF_CONFIG.carveDepth * (0.5 + Math.abs(this.turnIntensity) * 0.5);
            this.deformationBuffer.applySurfCarve(carvePos, SURF_CONFIG.carveWidth, depth);
            
            // Extra berm on outside of turn
            if (Math.abs(this.turnIntensity) > 0.3) {
                const bermSide = Math.sign(this.turnIntensity);
                const bermOffset = _scratchV3B.set(
                    Math.sin(this.surfDirection + bermSide * Math.PI / 2) * SURF_CONFIG.carveWidth,
                    0,
                    Math.cos(this.surfDirection + bermSide * Math.PI / 2) * SURF_CONFIG.carveWidth
                );
                
                const bermPos = carvePos.add(bermOffset);
                this.deformationBuffer.applySpellDeform(
                    bermPos,
                    SURF_CONFIG.carveWidth * 0.8,
                    0,
                    SURF_CONFIG.bermHeight * Math.abs(this.turnIntensity),
                    0.2,
                    0
                );
            }
            
            this.lastWakeEmit = this.scene.totalTime / 1000;
        }
    }
    
    _updateWake(deltaTime) {
        // Store wake points for trail rendering
        const wakePos = this.character.position.clone();
        wakePos.y = this.terrain.getHeightAt(wakePos.x, wakePos.z);
        
        this.wakePoints.push({
            position: wakePos.clone(),
            direction: this.surfDirection,
            turnIntensity: this.turnIntensity,
            speed: this.surfSpeed,
            time: this.scene.totalTime / 1000
        });
        
        // Limit wake points
        if (this.wakePoints.length > this.maxWakePoints) {
            this.wakePoints.shift();
        }
        
        // Emit spray particles based on speed and turn
        if (this.surfSpeed > 10.0 || Math.abs(this.turnIntensity) > 0.5) {
            const sprayCount = Math.floor(SURF_CONFIG.wakeParticleRate * deltaTime * (this.surfSpeed / SURF_CONFIG.maxSpeed));
            
            for (let i = 0; i < sprayCount; i++) {
                this._emitSprayParticle();
            }
        }
    }
    
    _emitSprayParticle() {
        // Simplified spray emission
        // In full implementation, would use particle system
        const sprayDir = _scratchV3A.set(
            (Math.random() - 0.5) * 2,
            0.5 + Math.random() * 1.5,
            (Math.random() - 0.5) * 2
        );
        
        // Spray directed backwards and outward based on turn
        const turnBias = this.turnIntensity * 2;
        sprayDir.x += turnBias;
        sprayDir.normalize().scaleInPlace(this.surfSpeed * 0.3);
    }
    
    _updateCameraEffects(deltaTime) {
        // Dynamic FOV based on speed
        const speedRatio = this.surfSpeed / SURF_CONFIG.maxSpeed;
        const targetFOV = SURF_CONFIG.cameraFOVBase + (SURF_CONFIG.cameraFOVMax - SURF_CONFIG.cameraFOVBase) * speedRatio;
        
        // Smooth FOV transition
        // Note: Babylon camera FOV adjustment would go here
        
        // Camera shake on hard turns
        if (Math.abs(this.turnIntensity) > 0.7 && this.surfSpeed > 15.0) {
            // Subtle shake amplitude based on turn intensity
            const shakeAmount = (Math.abs(this.turnIntensity) - 0.7) * 0.3;
            // Would apply to camera position
        }
        
        // Wind streak effect could be driven by speedRatio
    }
    
    /**
     * Get current wake points for rendering
     */
    getWakePoints() {
        return this.wakePoints;
    }
    
    /**
     * Get surf state for UI/effects
     */
    getState() {
        return {
            isSurfing: this.isSurfing,
            speed: this.surfSpeed,
            leanAngle: this.leanAngle,
            turnIntensity: this.turnIntensity
        };
    }
    
    dispose() {
        this.wakePoints = [];
    }
}
