# SNOWFLOW Performance Budget

## Frame Time Target
- **Target**: 90 FPS (11.1ms frame budget)
- **Floor**: 60 FPS (16.6ms frame budget)  
- **1% Low**: Must stay above 60 FPS

## Budget Allocation (Target 90 FPS)

| System | Budget (ms) | Target % | Notes |
|--------|-------------|----------|-------|
| Terrain LOD Update | 0.5 | 4.5% | Clipmap ring updates |
| Snow Shader | 2.0 | 18% | Most critical system |
| Shadows (CSM) | 1.5 | 13.5% | 4 cascades, PCF |
| Character/Cloth | 0.8 | 7% | Verlet simulation |
| Spells/VFX | 1.5 | 13.5% | Particles, deformations |
| Snow Surf | 1.0 | 9% | Wake, carving |
| Post-Processing | 2.0 | 18% | TAA, SSAO, Bloom, etc |
| Misc/Overhead | 1.8 | 16.5% | Culling, UI, etc |
| **Total** | **11.1** | **100%** | |

## GC Prevention

- Zero `new` in render loop
- Pre-allocate all Vector3, Matrix, Quaternion
- Object pools for particles/decals
- Typed arrays for GPU uploads
- No map/filter/reduce in hot paths
