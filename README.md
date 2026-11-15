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

The GPU ray marcher samples class, matter and flow textures, revealing actual voxel lumens and vessel walls, not tube geometry. A separate trilinear 3D vessel-occupancy transfer texture smooths the visible outline of diagonal channels without changing the physical voxel-fluid simulation. You can hide low-density material with the cutoff slider, adjust opacity, use a section plane, and view tissue oxygen or blood flow.

## Layered, purpose-driven organ morphogenesis

The generator now uses **an anatomical zoning volume** alongside the matter and fluid volumes. Each voxel carries an organ-specific structural label, cell density, metabolic demand, extracellular matrix resistance, and arterial/venous affinity. Zoning changes the actual 3D tissue field, not merely its displayed color.

| Organ | Functional compartments | Structural vascular plan |
| --- | --- | --- |
| **Kidney** | Fibrous capsule, metabolically active cortex, lower-demand medullary pyramids, renal columns | Arterial supply prioritizes the cortex; interlobar/column corridors and lower-density medulla carry return branches and straight medullary connections. Cortex requires greater exchange coverage than the medulla. |
| **Liver** | Outer capsule, hexagonal hepatic lobule columns, portal territories, central venous territories | Inflow preferentially reaches portal territories; venous drainage converges on the longitudinal central-vein axes; sinusoid-like capillary links cross hepatocyte-rich tissue. |
| **Lung** | Pleura, bronchovascular connective tissue, alveolar parenchyma | Arterial branches prefer bronchovascular corridors; veins emphasize alveolar/intersegmental drainage, plus peripheral territories. Pulmonary arterial blood starts less oxygenated; alveolar tissue exchanges oxygen with capillary fluid. |
| **Heart** | Epicardium, high-demand myocardium, endocardium | Surface coronary branches feed penetrating myocardial channels; surface vessels also collect venous return. Myocardial capillary spacing is tighter to supply densely packed muscle. |
| **Organoid** | Highly active proliferating shell, interstitial matrix, less-active central core | A metabolically expensive growing rim receives most new targets; a lower-demand interior remains distinguishable from healthy tissue. |

The morphology templates are **research-inspired approximations**, not anatomically precise micro-CT reconstructions. Their local layer labels are computational control fields rather than measured histology.

### Demand-directed routing

1. **Choose arterial and venous territories separately.** A functional quota assigns the organ's tissue zones their own supply and drainage targets. A hepatic central vein can have high drainage importance even when its zone occupies little volume.
2. **Route along a 3D tissue-resistance cost field.** A 26-direction weighted shortest-path search connects each target to the *lowest-cost point of the existing tree*. It uses Euclidean diagonal distances, compartment resistance, tissue density, and direction continuity. Each diagonal centerline segment gets face-connected intermediate lumen voxels so the pressure solver can carry fluid along it. Tests now count diagonals between **consecutive centerline voxels** rather than falsely counting diagonal endpoint offsets.
3. **Mature high-flow trunks.** Each target's metabolic workload accumulates up its parent path; heavily loaded arterial and venous parents widen into larger lumen regions, while fine terminals stay smaller.
4. **Bridge the exchange regions.** Metabolic demand, oxygen deficit and transport cost select capillary bed sites. Their paths join the arterial and venous matter volumes rather than becoming disconnected decorative branches.
5. **Solve pressure and advect dissolved contents.** The shared 3D pressure field moves fluid dye and plasma through lumen voxels. Neighbor-dependent oxygen/nutrient diffusion updates regional viability.

The resulting network is *purpose-guided and locally cost-aware*, but it does **not** solve a global optimum of energy consumption, blood viscosity, endothelial shear stress or tissue mechanics. This is a biologically motivated procedural model, not a complete embryogenesis engine.

### Anatomical sources

- [NCBI: renal blood supply, cortex, medulla and interlobar/arcuate organization](https://www.ncbi.nlm.nih.gov/books/NBK482385/)
- [AASLD: hepatic lobules, portal tracts, central veins and directed blood flow](https://www.aasld.org/liver-fellow-network/core-series/pathology-pearls/normal-liver-histology-101)
- [NCBI: pulmonary arteries alongside bronchioles and intersegmental venous drainage](https://www.ncbi.nlm.nih.gov/books/NBK545205/)
- [Hepatic metabolic zonation and sinusoidal gradients](https://pmc.ncbi.nlm.nih.gov/articles/PMC5257182/)

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
- **Layers:** compartment color map and an isolate-layer selector, so you can hide everything except cortex, medulla, portal areas, alveoli, myocardium, etc.
- **Volume toggles:** show/hide tissues, arterial voxels, venous voxels, capillary voxels, and dye independently.
- **Growth:** organ morphology, seed, branch proliferation, tissue heterogeneity, diffusion range, playback and viscosity controls.
- **Scanner:** density cutoff, opacity, Z cut plane, orbit/pan/zoom, and PNG screenshot.
- **Telemetry:** global viability, per-layer oxygen coverage, lumen occupancy by anatomical compartment, arterial/venous routes, and flowing voxel count.

## Development

No bundler required. ES modules and Three.js are loaded from GitHub Pages and a public CDN, so use a local HTTP server:

\`\`\`sh
python -m http.server 8000
\`\`\`

Open [http://localhost:8000](http://localhost:8000). You need a modern browser with WebGL2 and 3D textures. Native JavaScript unit tests:

\`\`\`sh
npm test
\`\`\`

Tests verify all five organ morphologies and their layers, organ-specific supply/drainage destinations, **true 26-direction centerline moves**, smooth venous volume occupancy, face-connected voxel circulation, inlet/outlet mass conservation, advected dye, oxygen exchange and encapsulating walls.

## Research background

The approach is a creative approximation of hypoxia-driven angiogenesis, anastomosis, cell density differentiation, flow-driven network maturation, and diffusion. For a medical-grade model you'd need calibrated cell-specific signaling, tissue biomechanics, experimentally measured permeability, validated vessel diameters, and a full multiphase Navier–Stokes / hemorheology solver.

Source references: [vascular development review](https://pmc.ncbi.nlm.nih.gov/articles/PMC8077227/), [hypoxia and sprouting](https://pmc.ncbi.nlm.nih.gov/articles/PMC6309638/).

## Deployment

The GitHub Actions workflow in \`.github/workflows/deploy.yml\` runs JavaScript syntax checks and voxel-fluid tests. The repository's native **Pages build and deployment** workflow publishes the static site from \`main\`. Separating these pipelines avoids duplicate GitHub Pages artifact deployments.
