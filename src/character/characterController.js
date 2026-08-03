/**
 * Character Controller - Third-person movement with cloth simulation.
 * Handles WASD locomotion, foot planting, and robe physics.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexBuffer } from '@babylonjs/core/Meshes/buffer.js';

// Pre-allocated scratch vectors (zero GC in hot paths)
const _scratchV3A = new Vector3();
const _scratchV3B = new Vector3();
const _scratchV3C = new Vector3();
const _scratchQuat = new Quaternion();

const CHARACTER_CONFIG = {
    moveSpeed: 6.0,
    sprintMultiplier: 1.8,
    rotationSpeed: 8.0,
    acceleration: 15.0,
    deceleration: 20.0,
    gravity: 9.8,
    footstepInterval: 0.7 // seconds at normal speed
};

export class CharacterController {
    constructor(scene, camera, terrain) {
        this.scene = scene;
        this.camera = camera;
        this.terrain = terrain;
        
        // Character state
        this.position = new Vector3(0, 0, 0);
        this.velocity = new Vector3(0, 0, 0);
        this.rotation = 0; // Y-axis rotation in radians
        this.onGround = true;
        
        // Movement input
        this.moveInput = new Vector3(0, 0, 0); // X = strafe, Z = forward
        this.isSprinting = false;
        
        // Animation state
        this.walkCycle = 0;
        this.lastFootstepTime = 0;
        this.leftFootDown = false;
        
        // Cloth simulation points (simplified Verlet)
        this.clothPoints = [];
        this._initCloth();
        
        // Character mesh placeholder (will be replaced with full character)
        this.mesh = this._createPlaceholderMesh();
        
        // Input handlers
        this._setupInputs();
    }
    
    _initCloth() {
        // Initialize cloth simulation points along robe
        // Rows: hem, knees, waist, shoulders
        // Columns: front, sides, back
        const rows = 4;
        const cols = 8;
        
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const angle = (c / cols) * Math.PI * 2;
                const radius = 0.3 + (r * 0.05);
                const height = -0.2 - (r * 0.35);
                
                this.clothPoints.push({
                    position: new Vector3(
                        Math.cos(angle) * radius,
                        height,
                        Math.sin(angle) * radius
                    ),
                    previous: new Vector3(
                        Math.cos(angle) * radius,
                        height,
                        Math.sin(angle) * radius
                    ),
                    pinned: r === rows - 1, // Top row is pinned to body
                    windInfluence: 0.5 + Math.random() * 0.5
                });
            }
        }
    }
    
    _createPlaceholderMesh() {
        // Simple capsule placeholder - will be replaced with full character model
        const mesh = new Mesh('character_placeholder', this.scene);
        mesh.visibility = 0; // Hidden, just for collision reference
        return mesh;
    }
    
    _setupInputs() {
        // Keyboard input tracking
        this.keys = {};
        
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            this._updateFromKeys();
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
            this._updateFromKeys();
        });
    }
    
    _updateFromKeys() {
        // WASD relative to camera facing
        let forward = 0;
        let strafe = 0;
        
        if (this.keys['KeyW'] || this.keys['ArrowUp']) forward += 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) forward -= 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) strafe -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) strafe += 1;
        if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) this.isSprinting = true;
        else this.isSprinting = false;
        
        // Normalize input vector
        const len = Math.sqrt(forward * forward + strafe * strafe);
        if (len > 0) {
            forward /= len;
            strafe /= len;
        }
        
        this.moveInput.x = strafe;
        this.moveInput.z = forward;
    }
    
    /**
     * Update character physics and animation
     */
    update(deltaTime) {
        // Get camera direction (horizontal only)
        const camForward = _scratchV3A.copyFrom(this.camera.getForward());
        camForward.y = 0;
        camForward.normalize();
        
        const camRight = _scratchV3B.copyFrom(this.camera.getRight());
        camRight.y = 0;
        camRight.normalize();
        
        // Calculate movement direction relative to camera
        _scratchV3C.set(camForward.x * this.moveInput.z + camRight.x * this.moveInput.x,
                        0,
                        camForward.z * this.moveInput.z + camRight.z * this.moveInput.x);
        
        const targetSpeed = this.moveInput.length() > 0.1 
            ? CHARACTER_CONFIG.moveSpeed * (this.isSprinting ? CHARACTER_CONFIG.sprintMultiplier : 1.0)
            : 0;
        
        // Smooth acceleration/deceleration
        const accel = targetSpeed > this.velocity.length() 
            ? CHARACTER_CONFIG.acceleration 
            : CHARACTER_CONFIG.deceleration;
        
        const currentSpeed = this.velocity.length();
        const newSpeed = currentSpeed + (targetSpeed - currentSpeed) * accel * deltaTime;
        
        if (_scratchV3C.length() > 0.01) {
            _scratchV3C.normalize().scaleInPlace(newSpeed);
            this.velocity.copyFrom(_scratchV3C);
            
            // Rotate character to face movement direction
            const targetRotation = Math.atan2(_scratchV3C.x, _scratchV3C.z);
            const rotDiff = targetRotation - this.rotation;
            // Normalize to [-PI, PI]
            const normalizedDiff = Math.atan2(Math.sin(rotDiff), Math.cos(rotDiff));
            this.rotation += normalizedDiff * CHARACTER_CONFIG.rotationSpeed * deltaTime;
        } else {
            this.velocity.scaleInPlace(1 - CHARACTER_CONFIG.deceleration * deltaTime);
        }
        
        // Apply gravity if airborne
        if (!this.onGround) {
            this.velocity.y -= CHARACTER_CONFIG.gravity * deltaTime;
        }
        
        // Update position
        this.position.x += this.velocity.x * deltaTime;
        this.position.z += this.velocity.z * deltaTime;
        
        // Ground detection and height snapping
        const groundHeight = this.terrain.getHeightAt(this.position.x, this.position.z);
        const characterHeight = 1.7; // Eye level
        
        if (this.position.y <= groundHeight + characterHeight) {
            this.position.y = groundHeight + characterHeight;
            this.velocity.y = 0;
            this.onGround = true;
        } else {
            this.onGround = false;
        }
        
        // Update walk cycle for footstep timing
        if (this.velocity.length() > 0.5 && this.onGround) {
            this.walkCycle += this.velocity.length() * deltaTime * 2.0;
            
            // Footstep timing
            const timeSinceLastStep = this.scene.totalTime / 1000 - this.lastFootstepTime;
            const stepInterval = CHARACTER_CONFIG.footstepInterval / (this.velocity.length() / CHARACTER_CONFIG.moveSpeed);
            
            if (timeSinceLastStep >= stepInterval) {
                this._onFootstep();
                this.lastFootstepTime = this.scene.totalTime / 1000;
            }
        }
        
        // Update cloth simulation
        this._updateCloth(deltaTime);
        
        // Update mesh position
        this.mesh.position.copyFrom(this.position);
        this.mesh.rotation.y = this.rotation;
    }
    
    _onFootstep() {
        // Alternate feet
        this.leftFootDown = !this.leftFootDown;
        
        // Calculate foot position for deformation
        const footOffset = this.leftFootDown ? -0.15 : 0.15;
        const footX = this.position.x + Math.sin(this.rotation) * footOffset;
        const footZ = this.position.z + Math.cos(this.rotation) * footOffset;
        
        // Trigger deformation callback if available
        if (this.onFootstepCallback) {
            this.onFootstepCallback(new Vector3(footX, this.position.y - 1.7, footZ));
        }
    }
    
    _updateCloth(deltaTime) {
        // Simplified Verlet integration for cloth
        const wind = _scratchV3A.set(Math.sin(this.scene.totalTime * 0.001) * 0.5, 0.1, Math.cos(this.scene.totalTime * 0.001) * 0.5);
        const movementWind = _scratchV3B.copyFrom(this.velocity).negate().scale(0.3);
        
        for (const point of this.clothPoints) {
            if (point.pinned) continue;
            
            // Store current position
            const temp = _scratchV3C.copyFrom(point.position);
            
            // Verlet integration: pos = pos + (pos - prev) + forces * dt^2
            const velocity = _scratchV3A.subtractVectors(point.position, point.previous);
            velocity.scaleInPlace(0.98); // Damping
            
            // Apply forces
            const forces = _scratchV3B.copyFrom(wind).add(movementWind);
            forces.y -= 2.0; // Gravity
            forces.scaleInPlace(point.windInfluence * deltaTime * deltaTime);
            
            point.previous.copyFrom(point.position);
            point.position.addInPlace(velocity).addInPlace(forces);
            
            // Distance constraints to pinned points (simplified)
            // In full implementation, would iterate multiple times
        }
    }
    
    /**
     * Get foot positions for deformation system
     */
    getFootPositions() {
        const leftFoot = new Vector3(
            this.position.x + Math.sin(this.rotation) * (-0.15),
            this.position.y - 1.7,
            this.position.z + Math.cos(this.rotation) * (-0.15)
        );
        
        const rightFoot = new Vector3(
            this.position.x + Math.sin(this.rotation) * 0.15,
            this.position.y - 1.7,
            this.position.z + Math.cos(this.rotation) * 0.15
        );
        
        return { leftFoot, rightFoot };
    }
    
    dispose() {
        this.mesh.dispose();
        this.clothPoints = [];
    }
}
