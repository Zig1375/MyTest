# SNOWFLOW — Tech Demo

Real-time snow graphics tech demo built with Babylon.js and WebGPU.

## Overview

This is a visual quality-focused tech demo featuring:

- Procedural terrain with multi-octave noise (dunes, drifts, sastrugi)
- Custom snow shading with subsurface scattering and glinting
- Terrain deformation buffer for persistent footprints and trails
- Third-person camera with spring-arm behavior
- Five momentum-based water/snow spells
- Snow-surf mechanic with carving wake
- GPU-driven cloth simulation on character robe
- Full post-processing chain (TAA, SSAO, bloom, tonemapping)

## Requirements

- Chrome stable on Windows 10/11
- WebGPU-capable GPU (RTX 2000 series or newer recommended)
- Target: 2560×1440 @ 90 FPS

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Controls

| Key | Action |
|-----|--------|
| WASD | Move |
| Mouse | Orbit camera (hold LMB) |
| Scroll | Zoom |
| 1-5 | Cast spells |
| RMB (hold) | Snow-surf |
| F1 / ` | Performance overlay |

## Project Structure

```
/src
  /core       Engine bootstrap, camera, performance monitor, pooling
  /terrain    Clipmap LOD, procedural heightfield, deformation buffers
  /shaders    WGSL snow shader code
  /character  Controller, robe cloth, shell fur
  /spells     Spell implementations + shared bending primitives
  /vfx        Particle systems, decals, spray
  /post       Post-processing chain
  /ui         Settings overlay
/assets       Vendored CC0 assets
```

## Documentation

- `ASSETS.md` - Third-party asset licenses
- `DECISIONS.md` - Deviations from brief with rationale  
- `PERF.md` - Frame budget tracking per system

## Milestones

1. **Foundation** — WebGPU boot, Vite, render loop, settings overlay, camera, WASD movement
2. **Terrain & Snow Shading** — Clipmap, procedural heightfield, full snow material, sun, shadows, sky IBL, fog
3. **Deformation** — Terrain state buffer, footfall displacement with berms, refill, correct normals
4. **Character** — Robe, cloth simulation, shell fur, locomotion, foot planting, spray
5. **Snow-Surf** — Wake generation, carving, body lean, banked camera
6. **Spells** — All five spells writing into terrain
7. **Post-Processing & Polish** — Full chain, tonemapping, spindrift, light shafts
8. **Performance Hardening** — Zero GC in render loop, 90 FPS sustained, pipeline warmup

## License

All third-party assets are CC0 or public domain. See `assets/ASSETS.md`.
