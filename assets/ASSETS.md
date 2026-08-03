# SNOWFLOW Assets

This document lists all third-party assets used in the demo and their licenses.

## Procedurally Generated

The following assets are generated procedurally at runtime and do not require external licensing:

- **Terrain heightfield**: Multi-octave noise with wind-directional sastrugi (see `src/terrain/noise.js`)
- **Snow surface detail normals**: Computed analytically from deformation buffer
- **Sparkle/glint pattern**: Hash-based procedural generation
- **Water flow maps**: Procedural animation
- **Particle textures**: Generated via canvas at runtime

## Vendored CC0 Assets

No external assets are currently vendored. If assets are added, they will be listed here with:

- Asset name
- Source URL
- License type (CC0, public domain, etc.)
- Location in `assets/` directory

## Fonts

System fonts only - no webfonts loaded.

## HDRIs / Environment Maps

Currently using Babylon.js procedural sky. If HDRI is added:

- Preferred source: Poly Haven (CC0)
- Will be stored in `assets/hdri/`

## PBR Material Scans

If snow/ice PBR scans are added:

- Preferred sources: ambientCG (CC0), Poly Haven (CC0)
- Will be stored in `assets/materials/`

---

**Note**: All assets must be CC0 or public domain. No attribution-required licenses.
