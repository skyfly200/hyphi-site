# LED Data Format (led-data-v1)

**Path in wiki:** `hyphi-hub/led-data-format`

The Hyphi LED data format is an open JSON specification that describes the physical
layout of every addressable LED on a Hyphi product.  The same file is consumed by:

- The **product viewer** on hyphi.art (3D LED visualisation)
- **Hyphi Hub** (pattern editor, real-time animation preview)
- **Firmware tools** (position-aware effects, spatial mapping)
- **Third-party integrations** via the OWLS protocol

Schema version covered here: **`1.0`**
Schema file: [`data/schema/led-data-v1.json`](https://github.com/skyfly200/hyphi-site/blob/main/data/schema/led-data-v1.json)

---

## Coordinate space

| Property | Value |
|---|---|
| Origin | Physical centre of the product's **base** (bottom face) |
| Up axis | **+Y** (Three.js / glTF convention) |
| Units | **Metres** (default) — configurable via `coordinateSpace.units` |
| Handedness | Right-handed |

---

## Top-level fields

```jsonc
{
  "version": "1.0",           // required — must match schema version
  "product": "glow-flora",    // required — URL-safe product slug
  "productName": "Glow Flora",
  "created": "2026-04-02",    // ISO 8601 date
  "coordinateSpace": { ... }, // optional — defaults below
  "strips": [ ... ],          // required — one entry per physical LED strip
  "leds":   [ ... ]           // required — one entry per LED
}
```

---

## `coordinateSpace`

```jsonc
{
  "units": "meters",  // "meters" | "cm" | "mm"
  "yUp":  true        // always true — Y is up
}
```

---

## `strips` array

Each strip maps to one data channel on the controller (one GPIO pin / one SPI bus).

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✓ | Zero-based strip index.  Matches firmware channel number. |
| `name` | string | ✓ | Human-readable label (e.g. `"Petal Ring A"`) |
| `type` | string | ✓ | IC type: `"WS2812B"` `"SK6812"` `"APA102"` `"WS2811"` `"SK9822"` |
| `count` | integer | ✓ | Number of LEDs on this strip |
| `colorOrder` | string | | `"GRB"` (default for WS2812B) `"RGB"` `"BGR"` `"RGBW"` |
| `maxCurrent_mA` | number | | Max draw at full white across all LEDs |
| `dataPin` | integer | | MCU GPIO pin |
| `group` | string | | Logical group name for animation targeting (e.g. `"petals"`) |

### Example

```json
{
  "id": 0,
  "name": "Petal Ring A",
  "type": "WS2812B",
  "count": 24,
  "colorOrder": "GRB",
  "maxCurrent_mA": 1440,
  "dataPin": 5,
  "group": "petals"
}
```

---

## `leds` array

One entry per physical LED, ordered by global ID (0-based, across all strips).

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | integer | ✓ | Global LED index (unique, 0-based, across all strips) |
| `stripId` | integer | ✓ | Which strip this LED belongs to (matches `strips[].id`) |
| `indexInStrip` | integer | ✓ | 0-based position within the strip — **this is the firmware pixel index** |
| `position` | `[x, y, z]` | ✓ | World-space position in the product's coordinate system |
| `normal` | `[nx, ny, nz]` | ✓ | Unit vector indicating the LED's emission direction |
| `defaultBrightness` | number | | 0–1, default full-power brightness |
| `defaultColor` | `[R, G, B]` | | Default colour as 8-bit RGB (or RGBW with 4 values) |
| `group` | string | | Which physical assembly this LED belongs to (e.g. `"petal-0"`) |
| `tags` | `string[]` | | Arbitrary tags for animation selection (e.g. `["ring-a", "petal"]`) |

### Example — single LED entry

```json
{
  "id": 0,
  "stripId": 0,
  "indexInStrip": 0,
  "position": [0.2400, 0.2195, 0.0000],
  "normal":   [0.8910, 0.4540, 0.0000],
  "defaultBrightness": 1.0,
  "defaultColor": [255, 80, 10],
  "group": "petal-0",
  "tags": ["petal", "ring-a", "strip-0"]
}
```

---

## Minimal complete file

```json
{
  "version": "1.0",
  "product": "my-product",
  "strips": [
    { "id": 0, "name": "Main Strip", "type": "WS2812B", "count": 12, "colorOrder": "GRB" }
  ],
  "leds": [
    {
      "id": 0, "stripId": 0, "indexInStrip": 0,
      "position": [0.05, 0.10, 0.00],
      "normal":   [0.00, 1.00, 0.00]
    }
  ]
}
```

---

## Using the file in firmware

The `indexInStrip` value maps directly to `leds[i]` in FastLED / NeoPixel / WLED:

```cpp
// FastLED example
for (int i = 0; i < NUM_LEDS; i++) {
  // led_positions[i] comes from leds[i].position in leds.json
  float distFromCentre = length(led_positions[i]);
  leds[i] = CHSV(distFromCentre * 200, 255, 255);
}
```

In the OWLS protocol, `stripId` and `indexInStrip` together form the canonical LED address.

---

## Using the file in Hyphi Hub

Hyphi Hub loads `leds.json` automatically from the product package (`.hpkg`).
The 3D position data powers:
- **Spatial patterns** — gradients, ripples, and emitter-based effects that are
  physically accurate to your layout
- **Pattern preview** — rendered in the same Three.js viewer as the product page
- **Export** — Hub can output WLED JSON, FastLED arrays, or raw OWLS frames
  using the strip/index mapping

---

## File naming convention

| File | Location |
|---|---|
| LED data | `data/{product-slug}/leds.json` |
| Schema | `data/schema/led-data-v1.json` |
| Inside a package | `leds.json` (at root of `.hpkg` archive) |

---

## Version history

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-02 | Initial release |
