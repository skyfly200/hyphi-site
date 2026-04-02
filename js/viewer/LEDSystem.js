import * as THREE from 'three';

/**
 * LEDSystem
 * Renders and animates a product's addressable LED array as emissive spheres
 * in the Three.js scene.  Driven by the led-data JSON format (led-data-v1.json).
 *
 * Supported states (set via setState):
 *   'off'      - all LEDs dark
 *   'idle'     - warm white at 30% brightness
 *   'chase'    - orange fire-fly chase travelling along each petal strip
 *   'breathe'  - slow sine-wave breathing in accent orange
 *   'map'      - colour-code by strip: strip 0 = orange, strip 1 = purple
 *   'rainbow'  - full HSL rainbow rotating
 */
export class LEDSystem {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;

    /** @type {LEDPoint[]} */
    this.leds = [];
    this._state = 'off';
    this._stateTime = 0;

    // Reusable colour object
    this._color = new THREE.Color();
  }

  /**
   * Initialise from the leds.json data structure.
   * Creates one instanced mesh for all LEDs for performance.
   */
  init(ledData) {
    this.clear();

    const geo = new THREE.SphereGeometry(0.006, 6, 6);

    // Use one InstancedMesh for all LEDs
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 0.3,
      metalness: 0,
      toneMapped: true,
    });

    this._instancedMesh = new THREE.InstancedMesh(geo, mat, ledData.leds.length);
    this._instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(ledData.leds.length * 3), 3
    );
    this._instancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this._instancedMesh.frustumCulled = false;
    this._instancedMesh.name = 'led-instances';
    this.scene.add(this._instancedMesh);

    // Also store point lights for the brightest LED (head of chase, etc.)
    this._pointLight = new THREE.PointLight(0xff6b35, 0, 0.3);
    this.scene.add(this._pointLight);

    const dummy = new THREE.Object3D();

    ledData.leds.forEach((led, i) => {
      const [px, py, pz] = led.position;
      const [nx, ny, nz] = led.normal;

      dummy.position.set(px, py, pz);
      dummy.lookAt(px + nx, py + ny, pz + nz);
      dummy.updateMatrix();
      this._instancedMesh.setMatrixAt(i, dummy.matrix);

      this.leds.push({
        id: led.id,
        stripId: led.stripId,
        indexInStrip: led.indexInStrip,
        position: new THREE.Vector3(px, py, pz),
        group: led.group,
        defaultColor: led.defaultColor || [255, 80, 10],
        r: 0, g: 0, b: 0,
      });
    });

    this._instancedMesh.instanceMatrix.needsUpdate = true;
    this._applyColors();
  }

  /**
   * Called each animation frame.
   * @param {number} time  seconds since page load
   */
  update(time) {
    if (!this._instancedMesh) return;

    this._stateTime = time;

    switch (this._state) {
      case 'off':     this._stateOff(); break;
      case 'idle':    this._stateIdle(time); break;
      case 'chase':   this._stateChase(time); break;
      case 'breathe': this._stateBreathe(time); break;
      case 'map':     this._stateMap(time); break;
      case 'rainbow': this._stateRainbow(time); break;
    }

    this._applyColors();
  }

  /** @param {'off'|'idle'|'chase'|'breathe'|'map'|'rainbow'} state */
  setState(state) {
    if (this._state === state) return;
    this._state = state;
  }

  clear() {
    if (this._instancedMesh) {
      this.scene.remove(this._instancedMesh);
      this._instancedMesh.geometry.dispose();
      this._instancedMesh.material.dispose();
      this._instancedMesh = null;
    }
    if (this._pointLight) {
      this.scene.remove(this._pointLight);
      this._pointLight = null;
    }
    this.leds = [];
  }

  // ── state handlers ──────────────────────────────────────────────────────────

  _stateOff() {
    this.leds.forEach(l => { l.r = 0; l.g = 0; l.b = 0; });
    if (this._pointLight) this._pointLight.intensity = 0;
  }

  _stateIdle(t) {
    const warmBrightness = 0.28 + 0.04 * Math.sin(t * 0.6);
    this.leds.forEach(l => {
      l.r = l.defaultColor[0] / 255 * warmBrightness;
      l.g = l.defaultColor[1] / 255 * warmBrightness;
      l.b = l.defaultColor[2] / 255 * warmBrightness;
    });
    if (this._pointLight) this._pointLight.intensity = 0.15;
  }

  _stateChase(t) {
    // Chase speed: 1 full revolution per second
    const chasePos = (t * 8) % this.leds.length;
    this.leds.forEach((l, i) => {
      const dist = Math.abs(i - chasePos) % this.leds.length;
      const tailLength = 6;
      const brightness = Math.max(0, 1 - dist / tailLength);
      const e = _easeOutQuad(brightness);
      l.r = (1.0  * e);
      l.g = (0.42 * e);
      l.b = (0.21 * e);
    });

    // Move point light to head of chase
    const headIdx = Math.floor(chasePos) % this.leds.length;
    if (this._pointLight && this.leds[headIdx]) {
      this._pointLight.position.copy(this.leds[headIdx].position);
      this._pointLight.intensity = 0.6;
      this._pointLight.color.setRGB(1, 0.42, 0.21);
    }
  }

  _stateBreathe(t) {
    const brightness = 0.15 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.4));
    this.leds.forEach(l => {
      l.r = l.defaultColor[0] / 255 * brightness;
      l.g = l.defaultColor[1] / 255 * brightness;
      l.b = l.defaultColor[2] / 255 * brightness;
    });
    if (this._pointLight) {
      this._pointLight.intensity = brightness * 0.4;
      this._pointLight.color.setRGB(1, 0.42, 0.21);
    }
  }

  _stateMap(t) {
    // Strip 0 → orange, strip 1 → purple, with slow pulse
    const pulse = 0.7 + 0.3 * Math.sin(t * 2.0);
    this.leds.forEach(l => {
      if (l.stripId === 0) {
        l.r = 1.0 * pulse;
        l.g = 0.42 * pulse;
        l.b = 0.21 * pulse;
      } else {
        l.r = 0.48 * pulse;
        l.g = 0.36 * pulse;
        l.b = 1.0  * pulse;
      }
    });
    if (this._pointLight) this._pointLight.intensity = 0;
  }

  _stateRainbow(t) {
    const speed = 0.4;
    const spread = 0.08; // hue spread across the array
    this.leds.forEach((l, i) => {
      const hue = ((t * speed) + i * spread) % 1.0;
      this._color.setHSL(hue, 1.0, 0.55);
      l.r = this._color.r;
      l.g = this._color.g;
      l.b = this._color.b;
    });
    if (this._pointLight) this._pointLight.intensity = 0;
  }

  // ── internal ────────────────────────────────────────────────────────────────

  _applyColors() {
    if (!this._instancedMesh) return;
    const ic = this._instancedMesh.instanceColor;

    // Drive emissiveIntensity via material — use max brightness across all LEDs
    let maxBrightness = 0;
    this.leds.forEach((l, i) => {
      const brightness = Math.max(l.r, l.g, l.b);
      if (brightness > maxBrightness) maxBrightness = brightness;
      ic.setXYZ(i, l.r, l.g, l.b);
    });

    this._instancedMesh.material.emissiveIntensity = maxBrightness > 0 ? 2.5 : 0;
    ic.needsUpdate = true;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function _easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }

/** @typedef {{ id: number, stripId: number, indexInStrip: number, position: THREE.Vector3, group: string, defaultColor: number[], r: number, g: number, b: number }} LEDPoint */
