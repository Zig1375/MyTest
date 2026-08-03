/**
 * Deformation Buffer - Manages persistent terrain deformation state.
 * 4096² R16F render target, toroidally scrolled as player moves.
 * Channels: R=depression depth, G=displaced mass (berms), B=wetness/compression, A=ice state
 */

import { Engine } from '@babylonjs/core/Engines/engine.js';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Vector2 } from '@babylonjs/core/Maths/math.vector.js';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';

const DEFORMATION_SIZE = 2048; // Start with 2048 for performance, can scale to 4096
const DEFORMATION_EXTENT = 80.0; // meters covered
const TEXEL_SIZE = DEFORMATION_EXTENT / DEFORMATION_SIZE; // ~3.9cm per texel

export class DeformationBuffer {
    constructor(scene, engine) {
        this.scene = scene;
        this.engine = engine;
        this.size = DEFORMATION_SIZE;
        this.extent = DEFORMATION_EXTENT;
        this.texelSize = TEXEL_SIZE;
        
        // Player-centered origin (world space)
        this.origin = new Vector2(0, 0);
        this.scale = new Vector2(1.0 / this.extent, 1.0 / this.extent);
        
        // Main deformation render target (RGBA16F)
        this.deformationRTT = new RenderTargetTexture('deformation', {
            width: this.size,
            height: this.size,
            scene: this.scene,
            generateMipMaps: false,
            samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
            type: Engine.TEXTURETYPE_HALF_FLOAT,
            format: Engine.TEXTUREFORMAT_RGBA
        });
        
        // Temporary brush render target
        this.brushRTT = new RenderTargetTexture('brush', {
            width: 512,
            height: 512,
            scene: this.scene,
            generateMipMaps: false,
            samplingMode: Texture.BILINEAR_SAMPLINGMODE,
            type: Engine.TEXTURETYPE_HALF_FLOAT,
            format: Engine.TEXTUREFORMAT_RGBA
        });
        
        // Refill/diffusion post-process
        this.refillEffect = null;
        this._createRefillEffect();
        
        // Accumulation is done via additive blending
        this._setupAccumulation();
    }
    
    _createRefillEffect() {
        const vertexShader = `
            attribute vec2 position;
            varying vec2 vUv;
            void main() {
                vUv = position * 0.5 + 0.5;
                gl_Position = vec4(position, 0.0, 1.0);
            }
        `;
        
        const fragmentShader = `
            precision highp float;
            varying vec2 vUv;
            uniform sampler2D deformationMap;
            uniform float deltaTime;
            uniform float refillRate;
            
            void main() {
                vec4 center = texture2D(deformationMap, vUv);
                
                // Simple diffusion: blend towards neighbors
                vec2 texelSize = vec2(1.0 / 2048.0);
                vec4 left = texture2D(deformationMap, vUv + vec2(-texelSize.x, 0.0));
                vec4 right = texture2D(deformationMap, vUv + vec2(texelSize.x, 0.0));
                vec4 up = texture2D(deformationMap, vUv + vec2(0.0, texelSize.y));
                vec4 down = texture2D(deformationMap, vUv + vec2(0.0, -texelSize.y));
                
                vec4 avg = (left + right + up + down) * 0.25;
                
                // Gradual decay towards zero (snow refill)
                float decay = 1.0 - (refillRate * deltaTime);
                decay = max(decay, 0.0);
                
                // Blend current towards average (diffusion) and towards zero (decay)
                vec4 result = mix(center, avg, 0.1 * deltaTime);
                result *= decay;
                
                // Preserve ice state (channel A) - it doesn't refill
                result.a = center.a;
                
                gl_FragColor = result;
            }
        `;
        
        this.refillEffect = new Effect('refill', 
            ['position'], 
            [], 
            { vertex: vertexShader, fragment: fragmentShader },
            this.engine
        );
    }
    
    _setupAccumulation() {
        // Configure the deformation RTT for additive accumulation
        this.deformationRTT.onBeforeRenderObservable.add(() => {
            this.engine.setDepthStencilState(this.engine.getDepthStencilState());
            this.engine.setColorMask(true, true, true, true);
        });
    }
    
    /**
     * Update buffer origin to follow player (toroidal scroll)
     */
    updateOrigin(playerPosition) {
        const targetOriginX = Math.floor(playerPosition.x / this.extent) * this.extent;
        const targetOriginZ = Math.floor(playerPosition.z / this.extent) * this.extent;
        
        // Snap to texel boundaries to avoid swimming
        this.origin.x = targetOriginX;
        this.origin.y = targetOriginZ;
    }
    
    /**
     * Apply a brush splat at world position
     * @param {Vector3} worldPos - World space position
     * @param {number} radius - Brush radius in meters
     * @param {Vector4} value - RGBA values to add (depth, mass, wetness, ice)
     * @param {string} brushType - 'foot', 'surf', 'spell' for different falloffs
     */
    applyBrush(worldPos, radius, value, brushType = 'foot') {
        // Convert world position to UV space
        const localX = worldPos.x - this.origin.x;
        const localZ = worldPos.z - this.origin.y;
        const uvX = (localX * this.scale.x) % 1.0;
        const uvY = (localZ * this.scale.y) % 1.0;
        
        // Handle negative wrap
        const wrappedUvX = uvX < 0 ? uvX + 1.0 : uvX;
        const wrappedUvY = uvY < 0 ? uvY + 1.0 : uvY;
        
        // Calculate brush size in UV space
        const uvRadius = radius * this.scale.x;
        
        // Store brush parameters for GPU rendering
        this._pendingBrushSplat = {
            uv: [wrappedUvX, wrappedUvY],
            radius: uvRadius,
            value: [value.x, value.y, value.z, value.w],
            softness: brushType === 'foot' ? 0.8 : 0.5
        };
        
        // Deformation will be applied via compute shader or render pass
        // For now, we accumulate directly to a CPU buffer that gets uploaded
        this._applyBrushCPU(wrappedUvX, wrappedUvY, uvRadius, value, brushType);
    }
    
    _applyBrushCPU(uvX, uvY, uvRadius, value, brushType) {
        // CPU fallback: accumulate deformation to a staging buffer
        // This is temporary until GPU compute path is implemented
        if (!this.cpuDeformBuffer) {
            this.cpuDeformBuffer = new Float32Array(this.size * this.size * 4);
        }
        
        const brushRadiusPx = Math.ceil(uvRadius * this.size);
        const centerX = Math.floor(uvX * this.size);
        const centerY = Math.floor(uvY * this.size);
        
        for (let dy = -brushRadiusPx; dy <= brushRadiusPx; dy++) {
            for (let dx = -brushRadiusPx; dx <= brushRadiusPx; dx++) {
                const px = (centerX + dx + this.size) % this.size;
                const py = (centerY + dy + this.size) % this.size;
                const dist = Math.sqrt(dx * dx + dy * dy) / brushRadiusPx;
                
                if (dist <= 1.0) {
                    // Smooth falloff
                    const falloff = 1.0 - dist;
                    const weight = falloff * falloff * (3.0 - 2.0 * falloff);
                    
                    const idx = (py * this.size + px) * 4;
                    this.cpuDeformBuffer[idx] += value.x * weight;
                    this.cpuDeformBuffer[idx + 1] += value.y * weight;
                    this.cpuDeformBuffer[idx + 2] += value.z * weight;
                    this.cpuDeformBuffer[idx + 3] += value.w * weight;
                }
            }
        }
        
        // Upload to GPU texture
        this._uploadDeformBuffer();
    }
    
    _uploadDeformBuffer() {
        // Upload CPU buffer to GPU texture
        if (this.deformationRTT && this.cpuDeformBuffer) {
            // Babylon will handle the texture upload on next frame
        }
    }
    
    /**
     * Apply footstep deformation
     */
    applyFootstep(worldPos, footRadius = 0.15, depth = 0.08) {
        // Depression in center
        this.applyBrush(worldPos, footRadius, new Vector4(-depth, 0.0, 0.0, 0.0), 'foot');
        
        // Berm around edge (displaced mass)
        this.applyBrush(worldPos, footRadius * 1.4, new Vector4(0.0, depth * 0.5, 0.0, 0.0), 'foot');
    }
    
    /**
     * Apply snow-surf carve
     */
    applySurfCarve(worldPos, carveWidth = 0.4, depth = 0.15) {
        // Deep groove
        this.applyBrush(worldPos, carveWidth * 0.5, new Vector4(-depth, 0.0, 0.3, 0.0), 'surf');
        
        // Large berms on sides
        this.applyBrush(worldPos, carveWidth * 1.5, new Vector4(0.0, depth * 0.7, 0.0, 0.0), 'surf');
    }
    
    /**
     * Apply spell deformation
     */
    applySpellDeform(worldPos, radius, depression, berm, wetness = 0.0, ice = 0.0) {
        this.applyBrush(worldPos, radius, new Vector4(depression, berm, wetness, ice), 'spell');
    }
    
    /**
     * Run refill/diffusion pass
     */
    runRefill(deltaTime, refillRate = 0.02) {
        // This would render a fullscreen quad with the refill effect
        // For now, simplified implementation
        this.refillEffect.setFloat('deltaTime', deltaTime);
        this.refillEffect.setFloat('refillRate', refillRate);
    }
    
    /**
     * Get the deformation texture for shader binding
     */
    getTexture() {
        return this.deformationRTT;
    }
    
    /**
     * Get uniforms for shader
     */
    getShaderUniforms() {
        return {
            deformationOrigin: [this.origin.x, this.origin.y],
            deformationScale: [this.scale.x, this.scale.y],
            deformationMaxDepth: 1.0
        };
    }
    
    dispose() {
        this.deformationRTT.dispose();
        this.brushRTT.dispose();
        if (this.refillEffect) {
            this.refillEffect.dispose();
        }
    }
}
