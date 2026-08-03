/**
 * Post-Processing Chain - TAA, SSAO, SSR, DOF, Bloom, Tonemapping, Film Grain
 * Order: TAA → SSAO → SSR → DOF → Bloom → Tonemap → Grain → Sharpen
 */

import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { Vector2 } from '@babylonjs/core/Maths/math.vector.js';

const POST_CONFIG = {
    taaEnabled: true,
    ssaoEnabled: true,
    ssrEnabled: true,
    dofEnabled: false,
    bloomEnabled: true,
    bloomThreshold: 0.85,
    bloomWeight: 0.3,
    tonemapType: 'ACES', // or 'AgX'
    grainEnabled: true,
    grainIntensity: 0.04,
    sharpenEnabled: true,
    sharpenAmount: 0.3
};

export class PostProcessChain {
    constructor(scene, engine, camera) {
        this.scene = scene;
        this.engine = engine;
        this.camera = camera;
        
        this.postProcesses = [];
        this.enabled = {};
        
        this._createPostProcesses();
    }
    
    _createPostProcesses() {
        // TAA (Temporal Anti-Aliasing)
        this._createTAA();
        
        // SSAO (Screen Space Ambient Occlusion)
        this._createSSAO();
        
        // SSR (Screen Space Reflections) - wet/icy surfaces only
        this._createSSR();
        
        // DOF (Depth of Field) - restrained
        this._createDOF();
        
        // Bloom
        this._createBloom();
        
        // Tonemapping (ACES/AgX)
        this._createTonemap();
        
        // Film Grain
        this._createGrain();
        
        // Sharpen (post-TAA)
        this._createSharpen();
    }
    
    _createTAA() {
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
            uniform sampler2D colorTexture;
            uniform sampler2D historyTexture;
            uniform vec2 jitterOffset;
            uniform float blendWeight;
            
            void main() {
                vec2 uv = vUv + jitterOffset;
                
                vec4 current = texture2D(colorTexture, uv);
                vec4 history = texture2D(historyTexture, vUv);
                
                // Simple temporal blend
                vec4 result = mix(history, current, blendWeight);
                
                gl_FragColor = result;
            }
        `;
        
        this.taaEffect = new Effect('taa',
            ['position'],
            ['colorTexture', 'historyTexture'],
            ['jitterOffset', 'blendWeight'],
            { vertex: vertexShader, fragment: fragmentShader },
            this.engine
        );
        
        this.taaHistoryRTT = null; // Created dynamically
        this.taaJitterIndex = 0;
        
        // 4x4 TAA jitter pattern
        this.jitterPattern = [
            [0.125, -0.375], [-0.125, 0.375], [0.625, 0.125], [-0.625, -0.125],
            [-0.375, 0.625], [0.375, -0.625], [0.875, -0.875], [-0.875, 0.875],
            [0.25, 0.75], [-0.25, -0.75], [0.5, -0.25], [-0.5, 0.25],
            [0.75, 0.5], [-0.75, -0.5], [-0.25, 0.25], [0.25, -0.25]
        ];
        
        this.enabled.taa = POST_CONFIG.taaEnabled;
    }
    
    _createSSAO() {
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
            uniform sampler2D depthTexture;
            uniform sampler2D normalTexture;
            uniform vec2 resolution;
            uniform float fov;
            uniform float radius;
            uniform float bias;
            uniform int samples;
            
            // Noise texture for AO rotation would be sampled here
            
            void main() {
                float depth = texture2D(depthTexture, vUv).r;
                if (depth >= 1.0) {
                    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
                    return;
                }
                
                vec3 normal = texture2D(normalTexture, vUv).xyz * 2.0 - 1.0;
                
                float ao = 0.0;
                float totalWeight = 0.0;
                
                // Simplified SSAO with spiral sampling
                for (int i = 0; i < 16; i++) {
                    float angle = float(i) * 2.5 + 1.0;
                    float r = sqrt(float(i) + 1.0) / 32.0;
                    
                    vec2 offset = vec2(cos(angle) * r, sin(angle) * r);
                    vec2 sampleUv = vUv + offset * radius;
                    
                    float sampleDepth = texture2D(depthTexture, sampleUv).r;
                    float depthDiff = (sampleDepth - depth) * 100.0;
                    
                    float weight = exp(-r * 4.0);
                    ao += max(0.0, depthDiff - bias) * weight;
                    totalWeight += weight;
                }
                
                ao = 1.0 - (ao / totalWeight);
                ao = clamp(ao, 0.0, 1.0);
                
                gl_FragColor = vec4(vec3(ao), 1.0);
            }
        `;
        
        this.ssaoEffect = new Effect('ssao',
            ['position'],
            ['depthTexture', 'normalTexture'],
            ['resolution', 'fov', 'radius', 'bias', 'samples'],
            { vertex: vertexShader, fragment: fragmentShader },
            this.engine
        );
        
        this.ssaoParams = {
            radius: 0.5,
            bias: 0.02,
            samples: 16
        };
        
        this.enabled.ssao = POST_CONFIG.ssaoEnabled;
    }
    
    _createSSR() {
        // Simplified SSR for wet/icy surfaces only
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
            uniform sampler2D colorTexture;
            uniform sampler2D depthTexture;
            uniform sampler2D normalTexture;
            uniform sampler2D roughnessTexture;
            uniform vec2 resolution;
            
            void main() {
                float depth = texture2D(depthTexture, vUv).r;
                if (depth >= 1.0) {
                    gl_FragColor = texture2D(colorTexture, vUv);
                    return;
                }
                
                vec3 normal = texture2D(normalTexture, vUv).xyz * 2.0 - 1.0;
                float roughness = texture2D(roughnessTexture, vUv).r;
                
                // Only reflect on smooth surfaces (wet/ice)
                if (roughness > 0.3) {
                    gl_FragColor = texture2D(colorTexture, vUv);
                    return;
                }
                
                // Simplified reflection ray march
                vec3 viewDir = normalize(vec3(vUv - 0.5, 0.5));
                vec3 reflectDir = reflect(viewDir, normal);
                
                float stepSize = 0.02;
                vec2 reflUv = vUv;
                float reflectedDepth = 0.0;
                
                for (int i = 0; i < 32; i++) {
                    reflUv += reflectDir.xy * stepSize;
                    if (reflUv.x < 0.0 || reflUv.x > 1.0 || reflUv.y < 0.0 || reflUv.y > 1.0) break;
                    
                    reflectedDepth = texture2D(depthTexture, reflUv).r;
                    if (reflectedDepth < depth) break;
                }
                
                vec3 reflection = texture2D(colorTexture, reflUv).rgb;
                float reflectWeight = 1.0 - roughness;
                
                vec3 original = texture2D(colorTexture, vUv).rgb;
                gl_FragColor = vec4(mix(original, reflection, reflectWeight * 0.5), 1.0);
            }
        `;
        
        this.ssrEffect = new Effect('ssr',
            ['position'],
            ['colorTexture', 'depthTexture', 'normalTexture', 'roughnessTexture'],
            ['resolution'],
            { vertex: vertexShader, fragment: fragmentShader },
            this.engine
        );
        
        this.enabled.ssr = POST_CONFIG.ssrEnabled;
    }
    
    _createDOF() {
        // Restrained depth of field
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
            uniform sampler2D colorTexture;
            uniform sampler2D depthTexture;
            uniform vec2 resolution;
            uniform float focusDistance;
            uniform float focalLength;
            uniform float aperture;
            
            void main() {
                float depth = texture2D(depthTexture, vUv).r;
                
                // Calculate blur amount based on depth
                float coc = abs(depth - focusDistance) * aperture / (depth * focalLength);
                coc = min(coc, 4.0);
                
                if (coc < 0.5) {
                    gl_FragColor = texture2D(colorTexture, vUv);
                    return;
                }
                
                // Simple box blur with variable radius
                float blurRadius = coc / resolution.x;
                vec3 color = vec3(0.0);
                float totalWeight = 0.0;
                
                for (float x = -2.0; x <= 2.0; x++) {
                    for (float y = -2.0; y <= 2.0; y++) {
                        vec2 offset = vec2(x, y) * blurRadius;
                        color += texture2D(colorTexture, vUv + offset).rgb;
                        totalWeight += 1.0;
                    }
                }
                
                gl_FragColor = vec4(color / totalWeight, 1.0);
            }
        `;
        
        this.dofEffect = new Effect('dof',
            ['position'],
            ['colorTexture', 'depthTexture'],
            ['resolution', 'focusDistance', 'focalLength', 'aperture'],
            { vertex: vertexShader, fragment: fragmentShader },
            this.engine
        );
        
        this.dofParams = {
            focusDistance: 10.0,
            focalLength: 50.0,
            aperture: 0.02
        };
        
        this.enabled.dof = POST_CONFIG.dofEnabled;
    }
    
    _createBloom() {
        // Multi-pass bloom with threshold
        this.bloomThreshold = POST_CONFIG.bloomThreshold;
        this.bloomWeight = POST_CONFIG.bloomWeight;
        
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
            uniform sampler2D colorTexture;
            uniform float threshold;
            uniform vec2 resolution;
            uniform int passDirection; // 0=horizontal, 1=vertical
            
            vec3 gaussianBlur(sampler2D tex, vec2 uv, vec2 direction) {
                vec3 sum = vec3(0.0);
                float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
                
                sum += texture2D(tex, uv).rgb * weights[0];
                for (int i = 1; i < 5; i++) {
                    sum += texture2D(tex, uv + direction * i * 2.0).rgb * weights[i];
                    sum += texture2D(tex, uv - direction * i * 2.0).rgb * weights[i];
                }
                
                return sum;
            }
            
            void main() {
                vec2 direction = passDirection == 0 ? vec2(resolution.x, 0.0) : vec2(0.0, resolution.y);
                
                vec3 bright = texture2D(colorTexture, vUv).rgb;
                bright = max(bright - threshold, 0.0);
                
                vec3 blurred = gaussianBlur(colorTexture, vUv, direction);
                
                gl_FragColor = vec4(blurred, 1.0);
            }
        `;
        
        this.bloomExtractEffect = new Effect('bloom_extract',
            ['position'],
            ['colorTexture'],
            ['threshold', 'resolution'],
            { vertex: vertexShader, fragment: fragmentShader },
            this.engine
        );
        
        this.enabled.bloom = POST_CONFIG.bloomEnabled;
    }
    
    _createTonemap() {
        // ACES or AgX tonemapping
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
            uniform sampler2D colorTexture;
            uniform int tonemapType; // 0=ACES, 1=AgX
            
            // ACES approximation
            vec3 aces(vec3 x) {
                const float a = 2.51;
                const float b = 0.03;
                const float c = 2.43;
                const float d = 0.59;
                const float e = 0.14;
                return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
            }
            
            // AgX approximation (simplified)
            vec3 agx(vec3 x) {
                x = max(x, 0.0);
                x = x / (x + 0.6);
                x = pow(x, vec3(1.0 / 2.2));
                return x;
            }
            
            void main() {
                vec3 color = texture2D(colorTexture, vUv).rgb;
                
                if (tonemapType == 0) {
                    color = aces(color);
                } else {
                    color = agx(color);
                }
                
                gl_FragColor = vec4(color, 1.0);
            }
        `;
        
        this.tonemapEffect = new Effect('tonemap',
            ['position'],
            ['colorTexture'],
            ['tonemapType'],
            { vertex: vertexShader, fragment: fragmentShader },
            this.engine
        );
        
        this.tonemapType = POST_CONFIG.tonemapType === 'AgX' ? 1 : 0;
    }
    
    _createGrain() {
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
            uniform sampler2D colorTexture;
            uniform float intensity;
            uniform float time;
            
            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
            }
            
            void main() {
                vec3 color = texture2D(colorTexture, vUv).rgb;
                
                vec2 grainPos = vUv * 100.0 + time;
                float grain = hash(floor(grainPos)) - 0.5;
                
                color += grain * intensity;
                color = clamp(color, 0.0, 1.0);
                
                gl_FragColor = vec4(color, 1.0);
            }
        `;
        
        this.grainEffect = new Effect('grain',
            ['position'],
            ['colorTexture'],
            ['intensity', 'time'],
            { vertex: vertexShader, fragment: fragmentShader },
            this.engine
        );
        
        this.grainIntensity = POST_CONFIG.grainIntensity;
        this.enabled.grain = POST_CONFIG.grainEnabled;
    }
    
    _createSharpen() {
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
            uniform sampler2D colorTexture;
            uniform vec2 resolution;
            uniform float amount;
            
            void main() {
                vec3 center = texture2D(colorTexture, vUv).rgb;
                vec2 texel = 1.0 / resolution;
                
                vec3 left = texture2D(colorTexture, vUv + vec2(-texel.x, 0.0)).rgb;
                vec3 right = texture2D(colorTexture, vUv + vec2(texel.x, 0.0)).rgb;
                vec3 up = texture2D(colorTexture, vUv + vec2(0.0, -texel.y)).rgb;
                vec3 down = texture2D(colorTexture, vUv + vec2(0.0, texel.y)).rgb;
                
                vec3 neighbors = (left + right + up + down) * 0.25;
                vec3 edge = center - neighbors;
                
                vec3 result = center + edge * amount;
                result = clamp(result, 0.0, 1.0);
                
                gl_FragColor = vec4(result, 1.0);
            }
        `;
        
        this.sharpenEffect = new Effect('sharpen',
            ['position'],
            ['colorTexture'],
            ['resolution', 'amount'],
            { vertex: vertexShader, fragment: fragmentShader },
            this.engine
        );
        
        this.sharpenAmount = POST_CONFIG.sharpenAmount;
        this.enabled.sharpen = POST_CONFIG.sharpenEnabled;
    }
    
    /**
     * Toggle individual post-process
     */
    toggle(name, enabled) {
        if (this.enabled.hasOwnProperty(name)) {
            this.enabled[name] = enabled;
        }
    }
    
    /**
     * Get all toggle states for UI
     */
    getToggleStates() {
        return { ...this.enabled };
    }
    
    dispose() {
        for (const effect of Object.values(this)) {
            if (effect && effect.dispose) {
                effect.dispose();
            }
        }
    }
}
