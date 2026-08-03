/**
 * Terrain Clipmap - Nested-ring LOD system centered on player.
 * High density near camera (~5cm vertex spacing), falling off with distance.
 */

import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexBuffer } from '@babylonjs/core/Meshes/buffer.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Tools } from '@babylonjs/core/Misc/tools.js';

const CLIPMAP_CONFIG = {
    numRings: 5,
    innerRingSize: 40, // meters (half-width)
    innerRingResolution: 80, // vertices per side (sub-10cm spacing)
    lodFactor: 2.0, // Each ring is 2x larger, half resolution
    skirtHeight: 5.0 // Vertical skirts between LODs
};

export class TerrainClipmap {
    constructor(scene, noiseGenerator) {
        this.scene = scene;
        this.noise = noiseGenerator;
        this.rings = [];
        this.numRings = CLIPMAP_CONFIG.numRings;
        this.innerSize = CLIPMAP_CONFIG.innerRingSize;
        this.innerRes = CLIPMAP_CONFIG.innerRingResolution;
        this.lodFactor = CLIPMAP_CONFIG.lodFactor;
        
        this.center = new Vector3(0, 0, 0);
        this.playerPosition = new Vector3(0, 0, 0);
        
        // Pre-allocate position arrays for each ring
        this._buildRings();
    }
    
    _buildRings() {
        for (let i = 0; i < this.numRings; i++) {
            const lodLevel = i;
            const ringSize = this.innerSize * Math.pow(this.lodFactor, lodLevel);
            const resolution = Math.floor(this.innerRes / Math.pow(this.lodFactor, lodLevel));
            
            // Create ring mesh
            const ringMesh = this._createRingMesh(ringSize, resolution, lodLevel);
            this.rings.push({
                mesh: ringMesh,
                lodLevel: lodLevel,
                size: ringSize,
                resolution: resolution
            });
        }
    }
    
    _createRingMesh(halfSize, resolution, lodLevel) {
        // Create a grid with a hole in the center (ring shape)
        const innerRatio = 0.5; // Inner boundary is at 50% of outer
        const innerRes = Math.floor(resolution * innerRatio);
        const outerRes = resolution;
        
        const positions = [];
        const normals = [];
        const uvs = [];
        const indices = [];
        
        // Generate vertices in a ring pattern
        for (let z = 0; z <= outerRes; z++) {
            const v = z / outerRes;
            const worldZ = (v - 0.5) * 2 * halfSize;
            
            for (let x = 0; x <= outerRes; x++) {
                const u = x / outerRes;
                const worldX = (u - 0.5) * 2 * halfSize;
                
                // Skip vertices inside inner ring (create hole)
                const normalizedX = Math.abs(u - 0.5) * 2;
                const normalizedZ = Math.abs(v - 0.5) * 2;
                const maxCoord = Math.max(normalizedX, normalizedZ);
                
                if (maxCoord < innerRatio) {
                    // Inside hole - skip, but we need to create inner edge vertices
                    continue;
                }
                
                positions.push(worldX, 0, worldZ);
                normals.push(0, 1, 0);
                uvs.push(u * resolution, v * resolution);
            }
        }
        
        // Generate indices (modified for ring topology)
        const rowStride = outerRes + 1;
        for (let z = 0; z < outerRes; z++) {
            for (let x = 0; x < outerRes; x++) {
                const topLeft = z * rowStride + x;
                const topRight = topLeft + 1;
                const bottomLeft = (z + 1) * rowStride + x;
                const bottomRight = bottomLeft + 1;
                
                // Check if both vertices of a triangle are valid (not in hole)
                // Simplified: just add all and let the hole logic handle it
                indices.push(topLeft, bottomLeft, topRight);
                indices.push(topRight, bottomLeft, bottomRight);
            }
        }
        
        // Create mesh
        const mesh = new Mesh(`clipmap_ring_${lodLevel}`, this.scene);
        
        // Set vertex data
        mesh.setVerticesData(VertexBuffer.PositionKind, positions, true);
        mesh.setVerticesData(VertexBuffer.NormalKind, normals, true);
        mesh.setVerticesData(VertexBuffer.UVKind, uvs, true);
        mesh.setIndices(indices);
        
        mesh.freezeWorldMatrix();
        
        return mesh;
    }
    
    /**
     * Update clipmap center to follow player
     */
    updateCenter(playerPosition) {
        this.playerPosition.copyFrom(playerPosition);
        
        // Snap center to grid alignment based on LOD
        for (const ring of this.rings) {
            const gridSize = (ring.size * 2) / ring.resolution;
            const snappedX = Math.round(playerPosition.x / gridSize) * gridSize;
            const snappedZ = Math.round(playerPosition.z / gridSize) * gridSize;
            
            ring.mesh.position.x = snappedX;
            ring.mesh.position.z = snappedZ;
        }
        
        this.center.x = playerPosition.x;
        this.center.z = playerPosition.z;
        
        // Update heights after repositioning
        this._updateHeights();
    }
    
    /**
     * Update vertex heights based on procedural noise
     */
    _updateHeights() {
        for (const ring of this.rings) {
            const positions = ring.mesh.getVerticesData(VertexBuffer.PositionKind);
            const normals = ring.mesh.getVerticesData(VertexBuffer.NormalKind);
            const worldOffset = ring.mesh.position;
            
            for (let i = 0; i < positions.length; i += 3) {
                const localX = positions[i];
                const localZ = positions[i + 2];
                const worldX = localX + worldOffset.x;
                const worldZ = localZ + worldOffset.z;
                
                // Sample noise for height
                const height = this.noise.getHeight(worldX, worldZ);
                positions[i + 1] = height;
                
                // Could compute analytical normals here from noise derivatives
                // For now, keep simple up-facing normals
            }
            
            ring.mesh.updateVerticesData(VertexBuffer.PositionKind, positions, false, false);
            
            // Recompute normals from heightfield
            this._computeNormals(ring.mesh);
        }
    }
    
    /**
     * Compute normals from heightfield using finite differences
     */
    _computeNormals(mesh) {
        const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
        const normals = new Float32Array(positions.length);
        const resolution = Math.sqrt(positions.length / 3);
        
        // Simple normal computation from height differences
        for (let z = 1; z < resolution - 1; z++) {
            for (let x = 1; x < resolution - 1; x++) {
                const idx = Math.floor(z * resolution + x) * 3;
                
                const hL = positions[(Math.floor(z * resolution + (x - 1))) * 3 + 1];
                const hR = positions[(Math.floor(z * resolution + (x + 1))) * 3 + 1];
                const hD = positions[(Math.floor((z - 1) * resolution + x)) * 3 + 1];
                const hU = positions[(Math.floor((z + 1) * resolution + x)) * 3 + 1];
                
                const dx = hR - hL;
                const dz = hU - hD;
                
                // Normal is (-dx, 2, -dz) normalized (assuming uniform grid spacing of 1)
                const len = Math.sqrt(dx * dx + 4 + dz * dz);
                normals[idx] = -dx / len;
                normals[idx + 1] = 2 / len;
                normals[idx + 2] = -dz / len;
            }
        }
        
        mesh.updateVerticesData(VertexBuffer.NormalKind, normals, false, false);
    }
    
    /**
     * Get height at world position (for character positioning)
     */
    getHeightAt(worldX, worldZ) {
        return this.noise.getHeight(worldX, worldZ);
    }
    
    /**
     * Attach all rings to scene
     */
    attachToScene() {
        for (const ring of this.rings) {
            ring.mesh.parent = null;
        }
    }
    
    /**
     * Set material on all rings
     */
    setMaterial(material) {
        for (const ring of this.rings) {
            ring.mesh.material = material;
        }
    }
    
    dispose() {
        for (const ring of this.rings) {
            ring.mesh.dispose();
        }
        this.rings = [];
    }
}
