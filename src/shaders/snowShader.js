/**
 * Snow Shader - WGSL implementation with multi-scale normals, subsurface scattering,
 * view-dependent glinting, and surface state handling.
 */

export const SNOW_VERTEX_SHADER = `
#version 300 es

precision highp float;

in vec3 position;
in vec3 normal;
in vec2 uv;

uniform mat4 worldViewProjection;
uniform mat4 world;
uniform mat4 view;
uniform mat4 projection;
uniform vec3 cameraPosition;

out vec3 vWorldPosition;
out vec3 vNormal;
out vec3 vViewDirection;
out vec2 vUv;
out vec3 vTangent;
out vec3 vBitangent;

void main() {
    vec4 worldPos = world * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    
    // Transform normal to world space
    mat3 normalMatrix = mat3(transpose(inverse(world)));
    vNormal = normalize(normalMatrix * normal);
    
    // View direction
    vViewDirection = normalize(cameraPosition - vWorldPosition);
    
    vUv = uv;
    
    // Triplanar mapping basis
    vTangent = normalize(cross(vec3(0.0, 1.0, 0.0), vNormal));
    vBitangent = cross(vNormal, vTangent);
    
    gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

export const SNOW_FRAGMENT_SHADER = `
#version 300 es

precision highp float;

in vec3 vWorldPosition;
in vec3 vNormal;
in vec3 vViewDirection;
in vec2 vUv;
in vec3 vTangent;
in vec3 vBitangent;

uniform vec3 sunDirection;
uniform vec3 sunColor;
uniform vec3 ambientColor;
uniform vec3 cameraPosition;
uniform float time;

// Deformation texture uniforms
uniform sampler2D deformationMap;
uniform vec2 deformationOrigin;
uniform vec2 deformationScale;
uniform float deformationMaxDepth;

// Surface state parameters
uniform float subsurfaceStrength;
uniform float glintIntensity;
uniform float wetness;
uniform float roughnessBase;
uniform float albedoVariation;

out vec4 fragColor;

// Hash function for stable noise
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float hash3(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.289))) * 43758.5453123);
}

// Value noise for detail
float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Multi-scale normal calculation
vec3 calculateDetailNormals(vec3 worldPos, vec3 baseNormal) {
    vec3 detailNormal = vec3(0.0);
    
    // Scale 1: Large ripples (tens of cm)
    vec2 uv1 = worldPos.xz * 0.5;
    float n1a = valueNoise(uv1);
    float n1b = valueNoise(uv1 + vec2(0.1, 0.0));
    float n1c = valueNoise(uv1 + vec2(0.0, 0.1));
    detailNormal += vec3(n1b - n1a, n1c - n1a, 0.0) * 0.3;
    
    // Scale 2: Medium granularity (few cm)
    vec2 uv2 = worldPos.xz * 2.0;
    float n2a = valueNoise(uv2);
    float n2b = valueNoise(uv2 + vec2(0.1, 0.0));
    float n2c = valueNoise(uv2 + vec2(0.0, 0.1));
    detailNormal += vec3(n2b - n2a, n2c - n2a, 0.0) * 0.15;
    
    // Scale 3: Fine grain (mm scale)
    vec2 uv3 = worldPos.xz * 8.0 + time * 0.01;
    float n3a = valueNoise(uv3);
    float n3b = valueNoise(uv3 + vec2(0.1, 0.0));
    float n3c = valueNoise(uv3 + vec2(0.0, 0.1));
    detailNormal += vec3(n3b - n3a, n3c - n3a, 0.0) * 0.05;
    
    // Blend with base normal
    detailNormal = normalize(detailNormal + baseNormal * 2.0);
    
    // Triplanar blend on steep slopes
    float slope = dot(baseNormal, vec3(0.0, 1.0, 0.0));
    float triplanarBlend = smoothstep(0.3, 0.8, abs(slope));
    
    return mix(detailNormal, baseNormal, triplanarBlend);
}

// Sample deformation buffer
vec4 sampleDeformation(vec3 worldPos) {
    vec2 localPos = worldPos.xz - deformationOrigin;
    vec2 wrappedPos = mod(localPos * deformationScale, 1.0);
    return texture(deformationMap, wrappedPos);
}

// Subsurface scattering approximation
vec3 subsurfaceScattering(vec3 lightDir, vec3 viewDir, vec3 normal, vec3 albedo) {
    // Wrapped diffuse for soft shadow transition
    float wrapValue = 0.5;
    float wrappedDiffuse = max(dot(normal, lightDir) + wrapValue, 0.0) / (1.0 + wrapValue);
    
    // Back-scatter term for translucency
    float backScatter = max(dot(-viewDir, lightDir), 0.0);
    backScatter = pow(backScatter, 3.0) * subsurfaceStrength;
    
    // Blue-white internal glow in shadows
    vec3 scatterColor = vec3(0.9, 0.95, 1.0);
    
    return albedo * wrappedDiffuse * sunColor + scatterColor * backScatter * ambientColor;
}

// View-dependent glinting
float calculateGlint(vec3 normal, vec3 viewDir, vec3 lightDir) {
    // Half vector for specular
    vec3 halfVec = normalize(viewDir + lightDir);
    
    // Grazing angle detection
    float grazingAngle = 1.0 - max(dot(viewDir, normal), 0.0);
    grazingAngle = smoothstep(0.6, 0.95, grazingAngle);
    
    // Specular lobe alignment
    float specularAlign = max(dot(halfVec, normal), 0.0);
    specularAlign = pow(specularAlign, 128.0); // Very narrow lobe
    
    // Stable hash-based sparkle (no crawling)
    vec3 sparklePos = vWorldPosition * 50.0;
    float sparkleHash = hash3(floor(sparklePos));
    float sparkleGate = step(0.97, sparkleHash); // Only ~3% of points glint
    
    // Combine factors
    float glint = specularAlign * grazingAngle * sparkleGate;
    
    return glint * glintIntensity * (1.0 - wetness); // Less glint when wet
}

// Fresnel-Schlick approximation
vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

void main() {
    // Base snow albedo with subtle variation
    vec3 baseAlbedo = vec3(0.92, 0.94, 0.96);
    float variation = (hash(vUv * 10.0) - 0.5) * albedoVariation;
    baseAlbedo += variation;
    
    // Sample deformation for compression/wetness
    vec4 deformData = sampleDeformation(vWorldPosition);
    float compression = deformData.r;
    float displacedMass = deformData.g;
    float surfaceWetness = deformData.b;
    float iceState = deformData.a;
    
    // Blend wetness from deformation and uniform
    float totalWetness = max(wetness, surfaceWetness);
    totalWetness = max(totalWetness, iceState * 0.8);
    
    // Modify albedo based on compression (darker when compressed)
    baseAlbedo *= 1.0 - compression * 0.3;
    
    // Calculate detailed normals
    vec3 detailNormal = calculateDetailNormals(vWorldPosition, vNormal);
    
    // Add displacement-induced normal perturbation
    if (deformData.g > 0.01) {
        // Berms have steeper normals
        float bermFactor = smoothstep(0.0, 0.5, displacedMass);
        detailNormal = normalize(detailNormal + vec3(0.0, bermFactor * 0.3, 0.0));
    }
    
    vec3 N = normalize(detailNormal);
    vec3 V = normalize(vViewDirection);
    vec3 L = normalize(-sunDirection);
    
    // Subsurface scattering (primary lighting)
    vec3 ssResult = subsurfaceScattering(L, V, N, baseAlbedo);
    
    // Ambient term with blue shift
    float ambientOcclusion = 1.0; // Could be enhanced with SSAO
    vec3 ambientTerm = baseAlbedo * ambientColor * ambientOcclusion;
    
    // Glinting (subtle!)
    float glint = calculateGlint(N, V, L);
    vec3 glintTerm = vec3(glint) * sunColor * 0.5;
    
    // Wet/ice specular
    float wetRoughness = mix(roughnessBase, 0.15, totalWetness);
    vec3 F0 = mix(vec3(0.04), vec3(0.08), totalWetness);
    vec3 halfVec = normalize(V + L);
    float NdotH = max(dot(N, halfVec), 0.0);
    float specular = pow(NdotH, 1.0 / wetRoughness);
    vec3 specularTerm = fresnelSchlick(max(dot(V, halfVec), 0.0), F0) * specular * sunColor * totalWetness;
    
    // Ice reflection boost
    specularTerm += iceState * 0.3 * sunColor;
    
    // Combine all terms
    vec3 finalColor = ssResult + ambientTerm + glintTerm + specularTerm;
    
    // Cool shadows (ambient is already blue-shifted)
    float sunVisibility = max(dot(N, L), 0.0);
    sunVisibility = smoothstep(-0.2, 0.2, sunVisibility);
    finalColor = mix(finalColor * 0.3 + ambientColor * 0.7, finalColor, sunVisibility);
    
    // Highlight roll-off (prevent blown-out whites)
    finalColor = finalColor / (1.0 + finalColor);
    
    fragColor = vec4(finalColor, 1.0);
}
`;
