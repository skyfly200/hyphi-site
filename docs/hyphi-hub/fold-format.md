# FOLD Format — Origami Design & Documentation

**Path in wiki:** `hyphi-hub/fold-format`

Hyphi uses the **FOLD** file format (Flexible Origami Linkage Design) to define
fold patterns for product components — silicone petals, enclosure panels, and
fabric elements.  The same `.fold` file drives the animated fold sequence in the
product viewer, feeds the `OrigamiFoldEffect` animation module, and serves as
design documentation.

FOLD is an open format by Erik Demaine et al.:
[github.com/edemaine/fold](https://github.com/edemaine/fold)

---

## Why FOLD?

| Benefit | Detail |
|---|---|
| Open standard | MIT licensed, widely supported by origami tools |
| JSON-based | Human-readable, version-controllable alongside product data |
| Dual use | Same file drives 3D animation AND documents the fold pattern |
| Multi-frame | Encodes both flat (unfolded) and assembled states in one file |
| Tool ecosystem | Origami Simulator, Rabbit Ear, Fold & Cut, RabbitEar.js |

---

## FOLD concepts

| Term | Meaning |
|---|---|
| **Vertex** | A point in the pattern (2D or 3D coordinates) |
| **Edge** | A line between two vertices — either a fold crease or a border |
| **Face** | A polygon (panel) bounded by edges |
| **Assignment** | The type of each edge: `M` mountain, `V` valley, `B` border, `F` flat, `U` unassigned |
| **Fold angle** | Target dihedral angle at each crease (degrees; 0 = flat, ±180 = fully folded) |
| **Frame** | One state of the model (flat, partially folded, assembled) |

### Edge assignments

| Code | Name | Meaning | Viewer display |
|---|---|---|---|
| `M` | Mountain | Folds toward the viewer (ridge up) | Orange crease line |
| `V` | Valley | Folds away from the viewer (valley down) | Purple crease line |
| `B` | Border | Perimeter/cut edge | Grey outline |
| `F` | Flat | Crease but no fold (scoring line) | Dashed line |
| `U` | Unassigned | Unknown | Hidden |

---

## File structure

```jsonc
{
  // ── File metadata ──────────────────────────────────────────────────
  "file_spec":    1.1,
  "file_creator": "Hyphi Design Tools",
  "file_title":   "Glow Flora Petal",
  "file_author":  "Hyphi",
  "file_description": "Translucent silicone petal with central rib fold.",
  "file_classes": ["singleModel"],

  // ── Geometry ────────────────────────────────────────────────────────
  "vertices_units":  "meter",
  "vertices_coords": [         // [x, y, z] per vertex (z optional for 2D)
    [-0.04, 0,    0],          // vertex 0 — left base
    [ 0.04, 0,    0],          // vertex 1 — right base
    [ 0,    0.20, 0]           // vertex 2 — tip
  ],
  "edges_vertices": [          // [v0, v1] index pairs
    [0, 1],                    // base edge
    [1, 2],                    // right edge
    [0, 2]                     // left edge / fold crease
  ],
  "edges_assignment": [        // one per edge
    "B",                       // border
    "B",                       // border
    "M"                        // mountain fold
  ],
  "edges_foldAngle": [         // degrees; 0=flat, negative=mountain
    0, 0, -45
  ],
  "faces_vertices": [          // polygon vertex indices
    [0, 1, 2]                  // one triangle face
  ],

  // ── Animation frames ────────────────────────────────────────────────
  "frames": [
    {
      "frame_title": "Flat",
      "edges_foldAngle": [0, 0, 0]   // all flat
    },
    {
      "frame_title": "Assembled",
      "edges_foldAngle": [0, 0, -45] // mountain fold at -45°
    }
  ]
}
```

---

## Glow Flora petal example

File: `data/glow-flora/fold/petal.fold`

The Glow Flora petal is a tapered leaf (8 cm × 20 cm in the flat pattern) with:

| Fold | Type | Angle | Effect |
|---|---|---|---|
| Central spine (3 segments) | Mountain `M` | −25° to −35° | Cups the petal lengthwise |
| Left lateral ribs (3 segments) | Valley `V` | +15° to +20° | Curves left edge upward |
| Right lateral ribs (3 segments) | Valley `V` | +15° to +20° | Curves right edge upward |

The `frames` array encodes two states: `flat` (all angles 0°) for the exploded
view and `cupped` (target angles) for the assembled view.

---

## Compatible design tools

| Tool | Use |
|---|---|
| **Origami Simulator** (origamisimulator.org) | Physics-based fold simulation, exports `.fold` |
| **Rabbit Ear** (rabbitear.org) | Programmatic origami in JS, native FOLD I/O |
| **Fold & Cut** (foldandcut.org) | Crease pattern design |
| **Blender** (with Origami addon) | 3D modelling with FOLD export |
| **Any text/JSON editor** | Direct authoring for simple patterns |

---

## Using FOLD in the product viewer

### Load and animate

```js
import { FOLDLoader }       from '/js/viewer/FOLDLoader.js';
import { OrigamiFoldEffect } from '/js/viewer/AnimationEffects.js';

// Load the .fold file
const result = await FOLDLoader.load('/data/glow-flora/fold/petal.fold');

console.log(result.meta);
// { title: 'Glow Flora Petal', author: 'Hyphi', units: 'meter', frameCount: 2 }

// Create animated effect
const effect = new OrigamiFoldEffect(scene, {
  ...result.origamiOptions,   // passes parsed folds array
  color: 0xff6b35,
});

// In scroll update (t = 0 flat → 1 fully folded):
effect.update(scrollProgress);
```

### Scale to product coordinates

FOLD files can be in any unit. Use `FOLDLoader.transform()` to scale to metres
and position correctly in the scene:

```js
const scaled = FOLDLoader.transform(
  rawFoldData,
  1.0,                              // already in metres
  new THREE.Matrix4()
    .makeRotationX(-Math.PI / 2)    // rotate flat pattern to Y-up
    .setPosition(0, 0.18, 0)        // position at flower head height
);
const result = FOLDLoader.parse(scaled);
```

### Export from viewer back to FOLD

Round-trip: edit fold angles in the viewer, export back to `.fold` for documentation:

```js
// After adjusting fold angles in OrigamiFoldEffect:
const foldData = FOLDLoader.exportFromFolds(effect.folds, {
  title:  'Glow Flora Petal v2',
  author: 'Hyphi',
});

// Download as .fold file
const blob = new Blob([JSON.stringify(foldData, null, 2)], { type: 'application/json' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'petal-v2.fold';
a.click();
```

---

## FOLD files in a `.hpkg` package

Include `.fold` files inside the package alongside the GLB models:

```
{product}.hpkg
├── manifest.json
├── assembly.json
├── leds.json
├── models/
│   └── petal.glb
├── fold/
│   └── petal.fold      ← fold pattern for this part
└── textures/
```

Reference from `assembly.json` part definitions:

```jsonc
{
  "id": "petal-0",
  "model": "models/petal.glb",
  "fold":  "fold/petal.fold",   // optional fold pattern for animation
  ...
}
```

The viewer will automatically load and animate the fold if a `fold` path is present.

---

## Authoring checklist

- [ ] Units set to `meter` in `vertices_units`
- [ ] All perimeter edges assigned `B` (border)
- [ ] Every interior fold edge assigned `M` or `V`
- [ ] `edges_foldAngle` matches `edges_vertices` length
- [ ] `frames` array has at least two entries: `flat` (all 0°) and `assembled`
- [ ] Pattern tested in Origami Simulator before export
- [ ] File placed in `data/{product}/fold/{part}.fold`
- [ ] Referenced in `assembly.json` part definition

---

## Further reading

- [FOLD spec v1.1](https://github.com/edemaine/fold/blob/main/doc/spec.md)
- [Origami Simulator](https://origamisimulator.org) — live physics simulation
- [Rabbit Ear JS library](https://rabbitear.org) — programmatic FOLD authoring
- [Hyphi AnimationEffects.js](/js/viewer/AnimationEffects.js) — `OrigamiFoldEffect` class
- [Hyphi FOLDLoader.js](/js/viewer/FOLDLoader.js) — parser and Three.js bridge
