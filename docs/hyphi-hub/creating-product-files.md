# Creating Product Files for the Hyphi Viewer

**Path in wiki:** `hyphi-hub/creating-product-files`

This guide walks you through producing every file needed to get a product
rendering in the Hyphi 3D viewer and Hyphi Hub — from a Blender model to a
finished `.hpkg` package.

---

## What you'll produce

| File | Purpose |
|---|---|
| `models/{part}.glb` | Draco-compressed geometry for each part |
| `textures/{part}-*.webp` | Diffuse, normal, roughness maps |
| `lightmaps/{part}-ao.webp` | Pre-baked ambient occlusion |
| `data/{product}/leds.json` | LED positions and strip data |
| `data/{product}/assembly.json` | Part transforms, explode offsets, scroll sequence |
| `{product}.hpkg` | Zipped package of all of the above |

---

## Tools required

| Tool | Use | Download |
|---|---|---|
| Blender 4.x | 3D modelling, UV unwrap, GLB export, AO bake | blender.org |
| `gltf-pipeline` | Draco compression of GLB files | `npm i -g gltf-pipeline` |
| `cwebp` | Convert PNG/JPG textures to WebP | developers.google.com/speed/webp |
| Python 3 or Node.js | Package automation | — |
| A modern browser | Browser-based lightmap baking (optional) | — |

---

## Step 1 — Model your product in Blender

### 1.1 — One object per part

Each **assembly part** (base, stem, petal, PCB, etc.) must be a separate Blender
object.  Name them to match the `id` fields you plan to use in `assembly.json`.

```
base       ← housing cylinder
pcb        ← circuit board disc
battery    ← battery pack
stem       ← poseable stem
petal-0    ← petal 1  (others are instances with different rotation)
```

### 1.2 — Set the product origin

Place each object's **origin at its natural pivot point**:
- `base` → centre of the bottom face (where it sits on a surface)
- `stem` → centre of the bottom connector
- `petal-0` → centre of the petal's attachment point to the stem head

The product's global origin (world 0, 0, 0) should be at the base's bottom centre.

### 1.3 — Scale in metres

Blender defaults to metres.  Keep it that way.  A 28 cm tall product = 0.28 m
in Blender.  Verify: `Scene Properties → Units → Unit System = Metric`.

### 1.4 — UV1 unwrap (for diffuse/normal/roughness)

For each part:
1. Select the object, enter **Edit Mode**
2. `A` to select all faces
3. `U → Smart UV Project` (or manual unwrap for better results)
4. Confirm the UV layout looks clean with minimal overlaps

### 1.5 — UV2 unwrap (for lightmap baking)

UV2 is a **second, non-overlapping UV channel** required for baked lightmaps.

1. In the UV editor, click the channel dropdown → **+ New** (creates UV channel 2)
2. In Edit Mode, select all faces → `U → Lightmap Pack`
   - Set **Margin** to `0.02` (prevents lightmap bleeding between UV islands)
3. Verify all islands are packed without overlap in UV2

---

## Step 2 — Record LED positions from Blender

### 2.1 — Place LED empties

For each physical LED on the product:
1. In the exact position of the LED's centre, add an **Empty → Plain Axes**
   (`Shift+A → Empty → Plain Axes`)
2. Orient the empty so its **+Z axis points in the LED's emission direction**
   (outward from the PCB surface)
3. Name the empty: `LED_{stripId}_{indexInStrip}` — e.g. `LED_0_7`

### 2.2 — Export positions with a Python script

Run this script in Blender's **Scripting** workspace to generate `leds.json`:

```python
import bpy, json, math

leds = []
strips = {}   # strip_id -> count

for obj in bpy.data.objects:
    if not obj.name.startswith("LED_"):
        continue
    parts = obj.name.split("_")   # LED_{stripId}_{index}
    strip_id  = int(parts[1])
    led_index = int(parts[2])

    # World position (Blender Z-up → convert to Y-up for Three.js)
    wx, wy, wz = obj.matrix_world.translation
    # Blender Z-up: (x, y, z) → Three.js Y-up: (x, z, -y)
    pos = [round(wx, 5), round(wz, 5), round(-wy, 5)]

    # Emission direction: local +Z in world space
    local_z = obj.matrix_world.to_3x3() @ __import__('mathutils').Vector((0, 0, 1))
    nrm = [round(local_z.x, 5), round(local_z.z, 5), round(-local_z.y, 5)]

    strips[strip_id] = max(strips.get(strip_id, 0), led_index + 1)

    leds.append({
        "id":             len(leds),
        "stripId":        strip_id,
        "indexInStrip":   led_index,
        "position":       pos,
        "normal":         nrm,
        "defaultBrightness": 1.0,
        "defaultColor":   [255, 80, 10],
        "group":          f"strip-{strip_id}",
        "tags":           [f"strip-{strip_id}"]
    })

leds.sort(key=lambda l: (l["stripId"], l["indexInStrip"]))

strip_list = [
    {"id": k, "name": f"Strip {k}", "type": "WS2812B",
     "count": v, "colorOrder": "GRB"}
    for k, v in sorted(strips.items())
]

output = {
    "version": "1.0",
    "product": "my-product",
    "coordinateSpace": {"units": "meters", "yUp": True},
    "strips": strip_list,
    "leds":   leds
}

path = "/tmp/leds.json"   # ← change to your output path
with open(path, "w") as f:
    json.dump(output, f, indent=2)
print(f"Exported {len(leds)} LEDs to {path}")
```

---

## Step 3 — Export GLB models

### 3.1 — Export each part separately

For each part object in Blender:

1. Select **only** that object
2. `File → Export → glTF 2.0 (.glb/.gltf)`
3. Settings:
   - **Format**: GLB
   - **Include**: Selected Objects only
   - **Mesh**: ✓ UVs, ✓ Normals, ✓ Vertex Colors (off), ✓ Tangents
   - **Materials**: **Do not export** (materials are applied at runtime)
   - **Animation**: Off (static parts only)
4. Save to `models/{part-id}.glb`

### 3.2 — Apply Draco compression

```bash
# Install once
npm install -g gltf-pipeline

# Compress each part
gltf-pipeline -i models/base.glb    -o models/base.glb    --draco.compressionLevel 7
gltf-pipeline -i models/pcb.glb     -o models/pcb.glb     --draco.compressionLevel 7
gltf-pipeline -i models/stem.glb    -o models/stem.glb    --draco.compressionLevel 7
gltf-pipeline -i models/battery.glb -o models/battery.glb --draco.compressionLevel 7
gltf-pipeline -i models/petal.glb   -o models/petal.glb   --draco.compressionLevel 7
```

Typical reduction: 60–80% smaller file size.

---

## Step 4 — Bake lightmaps

Choose **Option A** (Blender, highest quality) or **Option B** (browser, fastest setup).

### Option A — Blender AO bake

1. Switch render engine to **Cycles**
2. Select the part mesh
3. In the **UV Editor**, make sure **UV2** (the lightmap channel) is active
4. Add a new **Image Texture** node to the material — **do not connect it** —
   just select it (this is where Blender writes the bake)
   - Create a new image: `512 × 512`, black background
5. In **Render Properties → Bake**:
   - Bake Type: **Ambient Occlusion**
   - Selected to Active: off
   - Margin: 4 px
6. Click **Bake**
7. Save the bake image: `Image → Save As → lightmaps/{part}-ao.png`
8. Convert to WebP:
   ```bash
   cwebp -q 90 -lossless lightmaps/base-ao.png -o lightmaps/base-ao.webp
   ```

**Tip:** For better quality, use **Bake Type: Combined** with only
Indirect and AO checked.  This captures colour bleeding from nearby coloured surfaces.

### Option B — Browser bake (no Blender needed)

Open the product page in a browser, then in the browser console:

```js
import { LightmapBaker } from '/js/viewer/LightmapBaker.js';

const baker = new LightmapBaker(
  __hyphi_viewer.renderer,
  __hyphi_viewer.scene,
  { resolution: 512, samplesPerPass: 2, maxPasses: 128 }
);

// Add the meshes you want to bake
__hyphi_viewer.productGroup.traverse(obj => {
  if (obj.isMesh) baker.addMesh(obj);
});

baker.start(() => {
  console.log('Baking complete!');

  // Apply AO to each mesh and download
  __hyphi_viewer.productGroup.traverse(obj => {
    if (!obj.isMesh) return;
    const lm = baker.getLightmap(obj);
    if (lm) {
      obj.material.lightMap = lm;
      obj.material.lightMapIntensity = 1.4;
      obj.material.needsUpdate = true;
      baker.downloadLightmap(obj, `${obj.name}-ao.png`);
    }
  });
});
```

The baker runs 2 samples per animation frame and completes 128 passes
(~30 s on a modern laptop).  A progress indicator: `baker.progress` returns 0–1.

---

## Step 5 — Export textures

### 5.1 — Prepare texture maps in Blender

For each part:
1. Set up a **PBR material** with Diffuse, Normal, and Roughness nodes
2. In the Shader Editor, bake each map:
   - Diffuse → `{part}-diffuse.png` (sRGB)
   - Normal → `{part}-normal.png` (Linear, OpenGL convention)
   - Roughness → `{part}-roughness.png` (Linear, greyscale)

### 5.2 — Convert to WebP

```bash
# Diffuse (lossy, sRGB)
cwebp -q 85 textures/base-diffuse.png -o textures/base-diffuse.webp

# Normal + roughness (lossless to preserve precision)
cwebp -lossless textures/base-normal.png    -o textures/base-normal.webp
cwebp -lossless textures/base-roughness.png -o textures/base-roughness.webp
```

---

## Step 6 — Write `assembly.json`

`assembly.json` defines the part hierarchy, runtime materials, explode offsets,
and the scroll sequence that drives the camera.

```jsonc
{
  "version": "1.0",
  "product": "my-product",
  "name": "My Product",
  "parts": [
    {
      "id": "base",
      "name": "Housing Base",
      "model": "models/base.glb",

      // Where this part sits when fully assembled (world space, Y-up, metres)
      "assembledPosition": [0, 0, 0],
      "assembledRotation": [0, 0, 0],   // Euler XYZ radians

      // How far to move this part in the exploded view
      "explodeOffset":   [0, -0.18, 0],
      "explodeRotation": [0, 0, 0],
      "explodeOrder":    3,             // 0 = first to move, higher = later

      // Runtime PBR material (applied at load, can be swapped live)
      "material": {
        "color":     "#1a1a24",
        "roughness": 0.35,
        "metalness": 0.85
      }
    }
    // ... more parts
  ],

  "sequence": [
    {
      "id": "overview",
      "label": "Overview",
      "progressStart": 0.08,    // fraction of total scroll (0–1)
      "progressEnd":   0.20,
      "camera": {
        "position": [0, 0.32, 0.75],
        "target":   [0, 0.16, 0],
        "fov":      40
      },
      "productRotation": { "autoSpin": false, "targetY": 0.3 },
      "explodeFactor": 0,        // 0 = assembled, 1 = fully exploded
      "ledState": "idle",        // off | idle | chase | breathe | map | rainbow
      "tags": [
        {
          "id":             "tag-name",
          "label":          "My Product",
          "detail":         "Subtitle text",
          "anchorPosition": [0, 0.38, 0],   // 3D world position for the tag dot
          "side":           "right"          // "left" | "right"
        }
      ]
    }
    // ... more phases
  ]
}
```

**Explode offset tips:**
- Use your Blender scene to measure the final exploded position for each part
- `explodeOrder` staggers the animation: parts at order 0 move first
- The viewer lerps explodeFactor from 0→1 as the user scrolls through the
  `explode-intro` → `exploded` phases

---

## Step 7 — Test in the viewer

1. Put your files in the expected paths:
   ```
   data/{product}/assembly.json
   data/{product}/leds.json
   public/models/{product}/base.glb
   public/textures/{product}/base-diffuse.webp
   public/lightmaps/{product}/base-ao.webp
   ```
2. Create a product page (copy `products/glow-flora.html`, update the load paths)
3. Run a local server:
   ```bash
   npx serve .          # Node
   python3 -m http.server 8080  # Python
   ```
4. Open `http://localhost:8080/products/my-product.html`
5. Scroll through the page — verify each phase looks correct
6. In the browser console, test live swap:
   ```js
   __hyphi_viewer.swapTexture('base', '/textures/my-product/base-diffuse-v2.webp')
   ```

---

## Step 8 — Package as `.hpkg`

```python
import zipfile, pathlib, json, time

product = "my-product"
src     = pathlib.Path(".")
dist    = pathlib.Path("dist")
dist.mkdir(exist_ok=True)

parts_meta = []  # populate from assembly.json parts list

with zipfile.ZipFile(dist / f"{product}.hpkg", "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    z.write(f"data/{product}/assembly.json", "assembly.json")
    z.write(f"data/{product}/leds.json",     "leds.json")

    for glb in pathlib.Path(f"public/models/{product}").glob("*.glb"):
        z.write(glb, f"models/{glb.name}")

    for tex in pathlib.Path(f"public/textures/{product}").glob("*.webp"):
        z.write(tex, f"textures/{tex.name}")

    for lm in pathlib.Path(f"public/lightmaps/{product}").glob("*.webp"):
        z.write(lm, f"lightmaps/{lm.name}")

    manifest = {
        "version": "1.0",
        "product": product,
        "created": time.strftime("%Y-%m-%d"),
        "files": {
            "assembly": "assembly.json",
            "leds":     "leds.json",
            "models":   "models/",
            "textures": "textures/",
            "lightmaps": "lightmaps/"
        }
    }
    z.writestr("manifest.json", json.dumps(manifest, indent=2))

size_kb = (dist / f"{product}.hpkg").stat().st_size // 1024
print(f"✓  {product}.hpkg  ({size_kb} KB)")
```

---

## Checklist

- [ ] One Blender object per assembly part, named to match `assembly.json` `id` fields
- [ ] Scale in metres
- [ ] UV1 unwrapped (diffuse/normal)
- [ ] UV2 lightmap unwrap (non-overlapping, margin ≥ 0.02)
- [ ] LED empties placed and named `LED_{stripId}_{index}`
- [ ] `leds.json` exported via Python script and validated against schema
- [ ] GLB exported per-part, no materials embedded
- [ ] Draco compression applied (`gltf-pipeline -i ... --draco.compressionLevel 7`)
- [ ] Diffuse, normal, roughness baked and converted to WebP
- [ ] Lightmap AO baked (Blender Cycles or browser `LightmapBaker`)
- [ ] `assembly.json` written with all parts, explode offsets, and scroll sequence
- [ ] Tested locally in the viewer (all 8 scroll phases)
- [ ] Packaged as `.hpkg` and verified size is under 2 MB
