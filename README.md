# Procedural Volume

**A browser-based volumetric organ and vascular morphogenesis experiment.** Voxel tissue grows a connected arterial and venous circulation. Capillaries bridge the networks; an oxygen-demand feedback loop adds new vascular paths through underserved tissue. The result can be examined with an MRI-inspired synthetic volume scan, opacity and density filtering, cut planes, flow tracers and live telemetry.

[GitHub repository](https://github.com/joramvanloenen/Procedural-Volume) · [GitHub Pages application](https://joramvanloenen.github.io/Procedural-Volume/)

## Features

- **64 × 64 × 64 voxel density volume** with synthetic cortex, inner tissues, fibre variation and metabolic-demand maps.
- **Five adjustable specimen morphologies:** kidney, liver, heart, lung and experimental organoid. These are *stylized* density shapes, not anatomical reconstructions.
- **Angiogenesis-inspired branch growth:** distributed demand attractors guide artery/vein sprouts, with neighborhood checks preventing branches from leaving tissue.
- **Anastomosis and real connected loops:** capillary bridges join the arterial tree to a venous return tree. A second tissue-wide feedback pass creates additional connected paths to locally oxygen-deficient voxels.
- **Pressure-based flow calculation:** per-segment conductance scales approximately with radius to the fourth power divided by length, then a nodal pressure solver determines directed flow. Animated tracers follow flow-weighted downstream connections.
- **Oxygen propagation:** rasterized supply channels seed a voxel-neighborhood distance transform; diffusion reach and local demand determine simulated oxygen coverage.
- **MRI-inspired ray-marched volume viewer** with scan-density cutoff, clipping, tissue opacity, oxygen deficit heatmap and an anatomical palette.
- **Interactive WebGL2 visualization:** orbit, zoom, pan, pause, playback speed, live generation, visibility toggles and PNG capture.
- **Deterministic seeds** and separate controls for vessel proliferation, tissue heterogeneity and oxygen diffusion reach.

## Run locally

No build tools or npm install required. Open using a local HTTP server:

```bash
python -m http.server 8000
```

Then visit [http://localhost:8000](http://localhost:8000). Requires a modern browser with WebGL2 and 3D textures, plus internet access for the Three.js CDN import map. The project is ready for static GitHub Pages hosting.

## Controls

| Control | Effect |
| --- | --- |
| Morphology / seed | Regenerate the selected organ with a deterministic random seed |
| Branch proliferation | Number of sprouting attractors and maximum vascular growth |
| Cell heterogeneity | Tissue density and local metabolic-demand variations |
| Diffusion reach | Distance oxygen/nutrients penetrate tissue from supply vessels |
| Density cutoff | Remove lower-density tissue from the volumetric ray march |
| Tissue opacity | Change how deeply the scan reveals tissue and vascular structures |
| Section / cut plane | Discard volume and vessel segments beyond the selected Z section |
| MRI / Oxygen / Anatomy | Switch the synthetic scan transfer function |
| Vessel / tissue / tracer toggles | Independently reveal system layers |
| Drag, right drag, scroll | Orbit, pan, zoom |
| G | Regrow with the current settings |

## Model notes

The algorithm is *inspired by* developmental vasculogenesis, angiogenesis, sprouting in hypoxic tissue and anastomosis. It is **not** a detailed biomedical simulator. In particular, there are no endothelial-cell mechanics, VEGF reaction-diffusion PDEs, actual MRI physics, blood oxygen saturation equations, organ-specific circulatory topology, or measured anatomical scaling. The oxygen model uses a local voxel-neighborhood transport proxy, and the conductance model is a simplified Poiseuille-style network, not a resolved 3D fluid simulation.

There is an intentionally strict network invariant: a capillary begins at an arterial-network node and ends at a venous-network node. Thus, newly added supply channels are connected to both the inlet and the outlet. A pressure solve after every rescue batch verifies flow through the network, while density and oxygen volumes remain independent from the rendered tube surfaces.

## Biological references

- [AHA statement: developmental angiogenesis, vasculogenesis, remodeling and flow](https://pmc.ncbi.nlm.nih.gov/articles/PMC8077227/)
- [Vascular differentiation and hypoxia-driven sprouting](https://pmc.ncbi.nlm.nih.gov/articles/PMC6309638/)
- [Vessel sprouting, anastomosis and network maturation](https://pmc.ncbi.nlm.nih.gov/articles/PMC4190897/)

## Deployment

The repository includes a static GitHub Actions deployment workflow under `.github/workflows/deploy.yml`. In the repository settings, open **Pages → Build and deployment → Source → GitHub Actions** to enable initial publishing, if it is not yet enabled. Each push to `main` will then update the Pages site.

Copyright (c) 2026. Research/creative tooling prototype. Not for medical use.
