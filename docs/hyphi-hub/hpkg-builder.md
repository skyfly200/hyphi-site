# .hpkg Builder Tool

**Path in wiki:** `hyphi-hub/hpkg-builder`
**Tool URL:** `/tools/hpkg-builder.html` (serve locally or via Netlify preview)

A self-contained, browser-based tool that bakes ambient-occlusion lightmaps
and packages all product assets into a `.hpkg` archive — no install, no build
step, no server required beyond a static file host.

---

## Opening the tool

```bash
# From the hyphi-site root
npx serve .
# then open: http://localhost:3000/tools/hpkg-builder.html
```

Or use the Netlify branch preview (see branch deploy docs).

---

## Workflow (left → centre → right)

```
Left sidebar          Centre               Right sidebar
─────────────         ──────────           ──────────────
1. Drop files   →     Preview renders  →   Status badges update
2. Load models  →     Bake progress    →   Build package
3. Add textures →     Download LMs     →   Download .hpkg
```

### Step 1 — Drop `assembly.json`

Drag the file onto the **assembly.json** drop zone (or click to browse).

- The tool parses the `parts` array and generates one GLB slot per part in the
  **Part Models** section below.
- The right sidebar **Status** panel populates with a row per part showing
  `no model` and `unbaked` badges.

### Step 2 — Drop `leds.json`

Drag onto the **leds.json** drop zone.

- LED count and strip count appear in the **Package** stats panel.

### Step 3 — Drop part `.glb` files

Each part slot shows the part's `id` from `assembly.json`.
Drop the matching GLB onto its named slot.

- The model loads into the 3D preview immediately.
- If the model has Draco compression the Draco WASM decoder is loaded
  automatically (requires internet for the Google CDN).
- Assembled transforms (`assembledPosition`, `assembledRotation`) and runtime
  materials from `assembly.json` are applied to the loaded mesh.
- The badge for that part updates to **✓ glb**.

**Tip:** You can drop models in any order and add them while baking is in
progress — newly added meshes will not be included in an in-progress bake.

### Step 4 — Drop textures (optional)

Drop any number of `.webp`, `.png`, or `.jpg` files onto the **Textures** drop
zone. Files are stored by filename and included as-is in `textures/` inside the
archive.

Name convention: `{part-id}-diffuse.webp`, `{part-id}-normal.webp`,
`{part-id}-roughness.webp` — these are referenced automatically in
`manifest.json`.

### Step 5 — Bake Lightmaps (or Skip)

Click **Bake Lightmaps** to start ambient-occlusion baking.

| Setting | Value |
|---|---|
| Resolution | 512 × 512 px per mesh |
| Samples per frame | 2 hemisphere samples |
| Total passes | 128 (stable AO in ~30 s on a modern laptop) |
| Ray length | 0.3 m (configurable in `LightmapBaker.js`) |
| BVH acceleration | Loaded automatically if `three-mesh-bvh` is available |

Per-mesh progress bars appear in the **Bake Progress** section on the right.
When a mesh finishes, its badge updates to **✓ baked** and the lightmap is
applied live to the preview (you'll see the AO darken crevices in real time).

Click **Skip Baking** if you already have lightmap textures to include as
texture files, or want to package without AO.

**Note:** Meshes must have a `uv2` attribute for lightmap baking to work.
If UV2 is missing the baker silently skips that mesh.
See [creating-product-files.md](./creating-product-files.md) for how to add UV2
in Blender.

### Step 6 — Build `.hpkg`

Click **Build .hpkg** once baking is complete (or skipped).

The tool assembles the following ZIP archive:

```
{product}.hpkg
├── manifest.json      ← auto-generated from loaded data
├── assembly.json      ← your input file
├── leds.json          ← your input file
├── models/
│   └── {part-id}.glb  ← one per loaded model
├── textures/
│   └── {filename}     ← all dropped texture files
└── lightmaps/
    └── {mesh-name}-ao.png  ← baked AO (one per baked mesh)
```

Estimated compressed size is shown in the **Package** stats panel.

### Step 7 — Download

Click **Download** to save `{product-slug}.hpkg` to your downloads folder.

The archive is standard ZIP — rename to `.zip` to inspect with any file manager.

---

## Keyboard / UX notes

- **Start Over** button (header) reloads the page and clears all state.
- Drag-and-drop works on any drop zone; clicking opens a file browser.
- The 3D preview supports OrbitControls (drag to orbit, scroll to zoom).
- Baking is non-blocking — you can continue orbiting the preview during baking.

---

## Limitations

| Limitation | Workaround |
|---|---|
| UV2 required for baking | Add Lightmap Pack UV2 in Blender (see guide) |
| Baking uses CPU raycasting | Install three-mesh-bvh for 10× speedup |
| Lightmaps saved as PNG | Convert to WebP after download for ~40% size saving |
| No Draco compression of output | Pre-compress GLBs with `gltf-pipeline` before dropping |
| No progress for overall ZIP build | Large archives (>50 MB input) may pause briefly |

---

## Technical details

| Dependency | Source |
|---|---|
| Three.js r160 | `cdn.jsdelivr.net/npm/three@0.160.0` |
| GLTFLoader + DRACOLoader | Three.js addons (same CDN) |
| JSZip 3.10 | `cdn.jsdelivr.net/npm/jszip@3.10.1` |
| LightmapBaker | `../js/viewer/LightmapBaker.js` (local) |

The tool imports Three.js and JSZip via `importmap` — no bundler needed.
All processing happens in the browser; no data is sent to any server.
