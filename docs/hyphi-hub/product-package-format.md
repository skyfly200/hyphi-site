# Product Package Format (.hpkg)

**Path in wiki:** `hyphi-hub/product-package-format`

A `.hpkg` file is a **standard ZIP archive** (rename to `.zip` to open with any
archive tool) that bundles everything needed to render, animate, and simulate a
Hyphi product in one fast download.

```
glow-flora.hpkg
├── manifest.json        ← package metadata and file index
├── assembly.json        ← parts, transforms, explode offsets, scroll sequence
├── leds.json            ← LED positions and strip data (led-data-v1 format)
├── models/
│   ├── base.glb         ← Draco-compressed GLB for each part
│   ├── pcb.glb
│   ├── stem.glb
│   ├── battery.glb
│   └── petal.glb        ← shared petal mesh (instanced per-petal at runtime)
├── textures/
│   ├── base-diffuse.webp
│   ├── base-normal.webp
│   ├── petal-diffuse.webp
│   └── petal-roughness.webp
└── lightmaps/
    ├── base-ao.webp     ← pre-baked ambient occlusion (UV2 channel)
    └── stem-ao.webp
```

---

## Why a ZIP?

| Property | Detail |
|---|---|
| Format | Standard ZIP (DEFLATE compression, no password) |
| Extension | `.hpkg` — rename to `.zip` for manual inspection |
| Compatibility | Every OS, browser (`JSZip`), Python (`zipfile`), Node (`adm-zip`) |
| Streaming | HTTP range requests allow lazy-loading individual files |
| Signing | Future: detached Ed25519 signature in `manifest.json` |

---

## `manifest.json` reference

```jsonc
{
  "version": "1.0",            // package format version
  "product": "glow-flora",     // product slug (matches leds.json)
  "productName": "Glow Flora",
  "created": "2026-04-02",
  "schemaVersion": {
    "assembly": "1.0",
    "ledData":  "1.0"
  },
  "files": {
    "assembly": "assembly.json",
    "leds":     "leds.json",
    "models":   "models/",
    "textures": "textures/",
    "lightmaps": "lightmaps/"
  },
  "parts": [
    {
      "id":      "base",
      "model":   "models/base.glb",
      "diffuse": "textures/base-diffuse.webp",
      "normal":  "textures/base-normal.webp",
      "lightmap": "lightmaps/base-ao.webp"
    }
  ],
  "stats": {
    "totalLEDs":   48,
    "totalStrips": 2,
    "totalParts":  10,
    "fileSizeBytes": 1245184
  }
}
```

---

## Model files (`.glb`)

Each part is a separate GLB file with **Draco compression** applied.

| Requirement | Detail |
|---|---|
| Format | Binary glTF 2.0 (`.glb`) |
| Compression | Draco geometry compression (level 7 recommended) |
| UV channels | UV1 = diffuse/normal/roughness maps, UV2 = lightmap |
| Materials | Stripped — materials are applied at runtime from `assembly.json` |
| Origin | Each model's origin should be at the part's **pivot point** |
| Scale | Metres (1 Blender unit = 1 metre) |

### Why strip materials from GLBs?

Runtime material application lets the viewer swap colours, finishes, and custom
textures without re-downloading the geometry — enabling the live customisation
feature.  The canonical material definitions live in `assembly.json`.

---

## Texture files

All textures are **WebP** for smallest file size.

| Map | Format | Colour space | Notes |
|---|---|---|---|
| Diffuse / albedo | WebP | sRGB | Base colour |
| Normal | WebP | Linear | OpenGL convention (G = up) |
| Roughness | WebP (R channel) | Linear | Packed into R channel |
| Metalness | WebP (G channel) | Linear | Packed into G channel |
| Lightmap (AO) | WebP (R channel) | Linear | Applied to UV2; see below |

### Lightmap baking

Lightmaps encode pre-baked **ambient occlusion** (and optionally indirect bounce)
into the UV2 channel.  Two workflows are supported:

#### Option A — Blender (offline, highest quality)
1. Assign UV2 to the mesh (see step-by-step guide)
2. Bake **AO** (and optionally **Combined** with indirect) in Cycles
3. Export the bake result as a 512×512 or 1024×1024 WebP
4. Include in the `.hpkg` as `lightmaps/{part}-ao.webp`

#### Option B — Browser baking (no Blender needed)
The `LightmapBaker` module (`js/viewer/LightmapBaker.js`) bakes AO entirely in
the browser using progressive hemisphere ray sampling:

```js
import { LightmapBaker } from './viewer/LightmapBaker.js';

const baker = new LightmapBaker(renderer, scene, {
  resolution:    512,
  samplesPerPass: 2,
  maxPasses:     128,
  aoRadius:      0.3,
});

baker.addMesh(baseMesh);
baker.addMesh(stemMesh);

baker.start(() => {
  // Apply baked AO as lightmap
  baseMesh.material.lightMap          = baker.getLightmap(baseMesh);
  baseMesh.material.lightMapIntensity = 1.4;
  // Download for inclusion in the .hpkg
  baker.downloadLightmap(baseMesh, 'base-ao.png');
});
```

Browser baking runs at ~1–2 samples per animation frame so it stays
non-blocking.  128 passes typically produces stable results in about 30 seconds
on a modern GPU-accelerated browser.  Use `three-mesh-bvh` (loaded automatically
if available) for a ~10× ray-cast speedup.

---

## Loading a package in the browser

```js
import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

async function loadHpkg(url) {
  const buf  = await fetch(url).then(r => r.arrayBuffer());
  const zip  = await JSZip.loadAsync(buf);

  const manifest  = JSON.parse(await zip.file('manifest.json').async('text'));
  const assembly  = JSON.parse(await zip.file('assembly.json').async('text'));
  const ledData   = JSON.parse(await zip.file('leds.json').async('text'));

  // Load a model
  const glbBlob   = await zip.file('models/base.glb').async('blob');
  const glbUrl    = URL.createObjectURL(glbBlob);
  // pass glbUrl to GLTFLoader as normal, revoke after load

  return { manifest, assembly, ledData };
}
```

The `ProductViewer` will handle this automatically once `.hpkg` is wired up as
the primary load path (planned for v1.1 of the viewer).

---

## Creating a package

### Automated (Node.js)

```bash
# Install once
npm install -g adm-zip

node scripts/build-hpkg.js --product glow-flora --out dist/glow-flora.hpkg
```

The build script (not yet included — contributions welcome) reads from
`data/{product}/` and `public/models/{product}/` and zips them with DEFLATE level 6.

### Manual (Python)

```python
import zipfile, pathlib, json

product = "glow-flora"
root    = pathlib.Path(".")

with zipfile.ZipFile(f"dist/{product}.hpkg", "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    z.write(f"data/{product}/assembly.json", "assembly.json")
    z.write(f"data/{product}/leds.json",     "leds.json")
    for f in pathlib.Path(f"public/models/{product}").glob("**/*"):
        z.write(f, f.relative_to("public"))
    for f in pathlib.Path(f"public/textures/{product}").glob("**/*"):
        z.write(f, f.relative_to("public"))
    for f in pathlib.Path(f"public/lightmaps/{product}").glob("**/*"):
        z.write(f, f.relative_to("public"))
    # Build and write manifest
    manifest = { "version": "1.0", "product": product, ... }
    z.writestr("manifest.json", json.dumps(manifest, indent=2))

print(f"Packaged: dist/{product}.hpkg ({pathlib.Path(f'dist/{product}.hpkg').stat().st_size // 1024} KB)")
```

---

## File size targets

| Component | Target size |
|---|---|
| Each GLB model (Draco) | < 200 KB |
| Each diffuse texture (WebP) | < 100 KB |
| Each lightmap (WebP, 512px) | < 40 KB |
| Full `.hpkg` for Glow Flora | < 2 MB |

---

## Version history

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-02 | Initial release |
