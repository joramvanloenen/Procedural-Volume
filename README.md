# Procedural Volume — voxel fluid morphogenesis

**A 3D organ generator whose tissue, vessel walls, lumens, blood, oxygen, nutrients and local velocity live in the SAME voxel volume.** No decorative tube mesh, blood particle system, or hidden vessel-edge graph is used to represent circulation.

**[Open the live application](https://joramvanloenen.github.io/Procedural-Volume/)** · [Source repository](https://github.com/joramvanloenen/Procedural-Volume)

## Voxel volume

A single **64 × 64 × 64** material lattice contains:

| Material ID | Voxel contents |
| :-- | :-- |
| 0 | Empty / exterior |
| 1 | Soft parenchyma / low-density tissue |
| 2 | Dense cells / structured tissue |
| 3 | Arterial lumen, containing fluid |
| 4 | Venous lumen, containing fluid |
| 5 | Capillary lumen, containing fluid |
| 6 | Encapsulating vessel-wall tissue |

Additional 3D scalar/vector fields: **matter density**, **metabolic oxygen demand**, **tissue oxygen**, **nutrient concentration**, **blood oxygen**, **transported fluorescent dye**, **pressure**, **velocity X/Y/Z**, and **per-face fluid fluxes**.

The GPU ray marcher samples class, matter and flow textures, revealing actual voxel lumens and vessel walls, not tube geometry. You can hide low-density material with the cutoff slider, adjust opacity, use a section plane, and view tissue oxygen or blood flow.

## Embryonic vessel growth

Local six-neighbor tissue values and unmet metabolic demand direct branching arterial/venous fronts through voxel space. A spatial flood-distance pass identifies regions that need a capillary connection. Those regions are linked back through *contiguous* fluid-voxel channels to both arterial and venous matter. Vessel-wall material encapsulates all lumen boundaries after growth. Different cell and organ matter densities control their oxygen demand.

Morphologies: kidney, liver, heart, lung, and an experimental organoid. They are stylized forms, not medical reconstructions.

## Volumetric fluid dynamics

Flow is calculated directly on the 3D voxel lattice:

1. **Boundary conditions:** fixed inlet pressure (arterial) and outlet pressure (venous).
2. **Viscosity-modified face conductance:** neighboring fluid voxels share a conductive face, while solid/fluid interfaces are impermeable.
3. **Discrete pressure equation:** a matrix-free preconditioned conjugate-gradient solver computes the pressure potential for all connected lumen voxels.
4. **Conservative face flux:** velocity/flow comes from local pressure differences across shared voxel faces; interior flux divergence is approximately zero.
5. **Moving fluid contents:** oxygen-bearing plasma and dye advect through these faces with a flux-limited upwind finite-volume step.
6. **Oxygen and nutrient exchange:** the fluid/tissue boundary acts as a membrane; tissue fields diffuse through 6-neighborhoods and are consumed according to local metabolic demand.
7. **Pulsing flow and viscosity:** playback drives time-varying inlet delivery and viscosity attenuates transport.

The flow and chemical transport run inside a **dedicated Web Worker** so the WebGL volume view remains responsive. Dynamic 3D state textures are transferred to the rendering thread.

This is a **simplified pressure-driven low-Reynolds-number vascular fluid model, not a full Navier–Stokes blood cell simulation**, nor is the procedural anatomy medically validated. It does, however, move fluid *within volume cells* rather than animating abstract path segments.

## Interface

- **MRI:** synthetic scan transfer function and density cutoff.
- **Oxygen:** color tissue according to local oxygen content.
- **Anatomy:** material-class anatomy view, including vessel walls.
- **Flow:** pressure-based fluid colors and advected dye moving through lumens.
- **Volume toggles:** show/hide tissues, arterial voxels, venous voxels, capillary voxels, and dye independently.
- **Growth:** organ morphology, seed, branch proliferation, tissue heterogeneity, diffusion range, playback and viscosity controls.
- **Scanner:** density cutoff, opacity, Z cut plane, orbit/pan/zoom, and PNG screenshot.
- **Telemetry:** oxygen coverage, capillary/lumen voxel count, flowing voxels and perfused tissue.

## Development

No bundler required. ES modules and Three.js are loaded from GitHub Pages and a public CDN, so use a local HTTP server:

\`\`\`sh
python -m http.server 8000
\`\`\`

Open [http://localhost:8000](http://localhost:8000). You need a modern browser with WebGL2 and 3D textures. Native JavaScript unit tests:

\`\`\`sh
npm test
\`\`\`

They verify all five morphologies, physical 6-neighbor connectivity, conservation of inlet/outlet volume flux, no dye leakage into tissue, oxygen diffusion, and actual lumen-wall materials.

## Research background

The approach is a creative approximation of hypoxia-driven angiogenesis, anastomosis, cell density differentiation, flow-driven network maturation, and diffusion. For a medical-grade model you'd need calibrated cell-specific signaling, tissue biomechanics, experimentally measured permeability, validated vessel diameters, and a full multiphase Navier–Stokes / hemorheology solver.

Source references: [vascular development review](https://pmc.ncbi.nlm.nih.gov/articles/PMC8077227/), [hypoxia and sprouting](https://pmc.ncbi.nlm.nih.gov/articles/PMC6309638/).

## Deployment

The GitHub Actions workflow in \`.github/workflows/deploy.yml\` runs JavaScript syntax checks and voxel-fluid tests, then publishes the static app to GitHub Pages on each push to \`main\`.
