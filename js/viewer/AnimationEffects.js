import * as THREE from 'three';

/**
 * AnimationEffects
 * Three specialised assembly/manufacturing animation effects for Hyphi product pages.
 *
 *   HeatShrinkEffect  — tube conforming to a wire under heat
 *   OrigamiFoldEffect  — flat sheet folding along crease lines
 *   WireTwistEffect    — parallel wires twisting into a cable bundle
 *
 * All follow the same interface:
 *   new Effect(scene, options)
 *   effect.update(t)   // t = 0–1 normalised progress
 *   effect.dispose()
 */

// ─────────────────────────────────────────────────────────────────────────────
// HeatShrinkEffect
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Animates heatshrink tubing shrinking and conforming around a wire.
 *
 * At t=0 the tube is loose and cylindrical (preHeatRadius).
 * As t→1 it contracts radially toward the wire path, develops subtle wrinkle
 * noise mid-transition, and settles into a tight skin (postHeatRadius).
 *
 * @example
 *   const path = new THREE.CatmullRomCurve3([
 *     new THREE.Vector3(0, 0, 0),
 *     new THREE.Vector3(0, 0.12, 0.02),
 *     new THREE.Vector3(0, 0.26, 0),
 *   ]);
 *   const hs = new HeatShrinkEffect(scene, { path, color: 0x111122 });
 *   // in rAF loop:  hs.update(scrollProgress);
 */
export class HeatShrinkEffect {
  /**
   * @param {THREE.Scene} scene
   * @param {object} options
   * @param {THREE.CatmullRomCurve3} options.path         Wire centre-line
   * @param {number} [options.preHeatRadius=0.012]        Tube radius before shrink (m)
   * @param {number} [options.postHeatRadius=0.006]       Tube radius after shrink (m)
   * @param {number} [options.pathSegments=64]            Segments along the path
   * @param {number} [options.radialSegments=16]          Segments around the tube
   * @param {number} [options.color=0x1a1a2e]             Tube colour
   * @param {number} [options.wrinkleAmount=0.0018]       Peak radial wrinkle displacement
   */
  constructor(scene, options = {}) {
    this.scene  = scene;
    this.path   = options.path;
    this.r0     = options.preHeatRadius  ?? 0.012;
    this.r1     = options.postHeatRadius ?? 0.006;
    this.pSeg   = options.pathSegments   ?? 64;
    this.rSeg   = options.radialSegments ?? 16;
    this.wrinkle = options.wrinkleAmount ?? 0.0018;

    // Build geometry once; update vertex positions each frame
    this._geo = new THREE.TubeGeometry(this.path, this.pSeg, this.r0, this.rSeg, false);
    // Store the original (undeformed) positions for reference
    this._basePos = this._geo.attributes.position.array.slice();

    this._mat = new THREE.MeshStandardMaterial({
      color:     options.color ?? 0x1a1a2e,
      roughness: 0.75,
      metalness: 0.05,
      transparent: true,
      opacity:   0.92,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this._geo, this._mat);
    this.mesh.castShadow = true;
    this.scene.add(this.mesh);

    // Seed per-vertex noise offsets so wrinkles are consistent frame-to-frame
    const vCount = this._geo.attributes.position.count;
    this._noiseSeeds = new Float32Array(vCount);
    for (let i = 0; i < vCount; i++) {
      this._noiseSeeds[i] = (Math.sin(i * 127.1) * 0.5 + 0.5); // deterministic pseudo-random
    }
  }

  /**
   * @param {number} t  0 = relaxed tube, 1 = fully conformed
   */
  update(t) {
    t = Math.max(0, Math.min(1, t));

    const pos     = this._geo.attributes.position;
    const base    = this._basePos;
    const path    = this.path;

    // Wrinkle peaks at mid-transition (bell curve centred at t=0.45)
    const wrinklePeak = Math.exp(-Math.pow((t - 0.45) / 0.2, 2));
    const currentR    = this.r0 + (this.r1 - this.r0) * _easeInOutCubic(t);

    // Material tightens as it shrinks
    this._mat.roughness = 0.75 - t * 0.2;
    this._mat.opacity   = 0.92 + t * 0.07;

    const _p = new THREE.Vector3();
    const _center = new THREE.Vector3();
    const _dir    = new THREE.Vector3();

    for (let i = 0, l = pos.count; i < l; i++) {
      _p.set(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]);

      // Find nearest point on path
      const u = path.getUtoTmapping(0, _p.y / (path.getLength() || 1));
      path.getPoint(Math.max(0, Math.min(1, u)), _center);

      // Radial direction from path centre to vertex
      _dir.subVectors(_p, _center);
      const origR = _dir.length();
      if (origR < 1e-6) continue;
      _dir.normalize();

      // Wrinkle displacement — varies by vertex seed and sine of position
      const wrinkleDisp = this.wrinkle * wrinklePeak * (this._noiseSeeds[i] * 2 - 1)
        * Math.sin(i * 0.8 + t * Math.PI * 3);

      const newR = currentR + wrinkleDisp;
      _p.copy(_center).addScaledVector(_dir, newR);

      pos.setXYZ(i, _p.x, _p.y, _p.z);
    }

    pos.needsUpdate = true;
    this._geo.computeVertexNormals();
  }

  dispose() {
    this.scene.remove(this.mesh);
    this._geo.dispose();
    this._mat.dispose();
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// OrigamiFoldEffect
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Animates a flat sheet folding along defined crease lines into a 3D shape.
 *
 * Folds are defined as rotations of face groups around a hinge axis.
 * Each fold can be given a staggered start time so they sequence naturally.
 *
 * @example
 *   const effect = new OrigamiFoldEffect(scene, {
 *     size: 0.3,                // 30 cm square sheet
 *     color: 0xff6b35,
 *     folds: [
 *       // Fold the right half upward 90° around the centre vertical axis
 *       { axis: new THREE.Line3(new THREE.Vector3(0,-0.15,0), new THREE.Vector3(0,0.15,0)),
 *         angle: Math.PI / 2,  startT: 0.0, endT: 0.5 },
 *       // Then fold the top quarter back 45°
 *       { axis: new THREE.Line3(new THREE.Vector3(-0.15,0.075,0), new THREE.Vector3(0.15,0.075,0)),
 *         angle: -Math.PI / 4, startT: 0.4, endT: 0.9 },
 *     ]
 *   });
 *   effect.update(t);
 */
export class OrigamiFoldEffect {
  /**
   * @param {THREE.Scene} scene
   * @param {object} options
   * @param {number} [options.size=0.2]            Sheet side length (m)
   * @param {number} [options.color=0xff6b35]       Sheet colour
   * @param {object[]} options.folds               Array of fold definitions
   * @param {THREE.Line3} options.folds[].axis     The crease line (hinge axis)
   * @param {number} options.folds[].angle         Target rotation angle (radians)
   * @param {number} [options.folds[].startT=0]    Normalised t when this fold begins
   * @param {number} [options.folds[].endT=1]      Normalised t when this fold completes
   */
  constructor(scene, options = {}) {
    this.scene = scene;
    this.folds = options.folds || [];

    const size  = options.size  ?? 0.2;
    const color = options.color ?? 0xff6b35;

    // Root group for the whole sheet
    this._root = new THREE.Group();
    this._root.name = 'origami-root';
    this.scene.add(this._root);

    // Sheet material
    this._mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
    });

    // Build one flat panel per fold region.
    // For now, create a simple two-panel system (base + one flap per fold).
    // For complex origami, extend by subdividing into more panels.
    this._panels = [];
    this._buildPanels(size, color);

    // Crease lines rendered in accent colour
    this._creaseLines = [];
    this._buildCreaseLines(size);
  }

  _buildPanels(size, color) {
    const h = size / 2;

    // Base panel (stays fixed)
    const baseGeo = new THREE.PlaneGeometry(size, size);
    const baseMesh = new THREE.Mesh(baseGeo, this._mat);
    baseMesh.rotation.x = -Math.PI / 2;
    this._root.add(baseMesh);
    this._panels.push({ mesh: baseMesh, foldIndex: -1 });

    // One flap per fold
    this.folds.forEach((fold, fi) => {
      const geo  = new THREE.PlaneGeometry(size * 0.5, size);
      const mesh = new THREE.Mesh(geo, this._mat);

      // Position flap to align with fold axis
      const axisCenter = new THREE.Vector3();
      fold.axis.getCenter(axisCenter);
      mesh.position.copy(axisCenter);
      mesh.position.x += size * 0.25;

      // Each flap lives in its own pivot group so we rotate around the hinge
      const pivot = new THREE.Group();
      pivot.position.copy(axisCenter);
      pivot.add(mesh);
      mesh.position.x -= axisCenter.x;

      this._root.add(pivot);
      this._panels.push({ mesh, pivot, foldIndex: fi, baseAngle: 0 });
    });
  }

  _buildCreaseLines(size) {
    const creaseMat = new THREE.LineBasicMaterial({
      color: 0xff6b35,
      opacity: 0.6,
      transparent: true,
    });

    this.folds.forEach(fold => {
      const pts = [fold.axis.start.clone(), fold.axis.end.clone()];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, creaseMat);
      this._root.add(line);
      this._creaseLines.push({ line, geo });
    });
  }

  /**
   * @param {number} t  0 = flat sheet, 1 = fully folded
   */
  update(t) {
    t = Math.max(0, Math.min(1, t));

    this._panels.forEach(panel => {
      if (panel.foldIndex < 0 || !panel.pivot) return;
      const fold = this.folds[panel.foldIndex];

      // Local t for this fold's time window
      const lt = _clamp01((t - (fold.startT ?? 0)) / ((fold.endT ?? 1) - (fold.startT ?? 0)));
      const angle = fold.angle * _easeInOutCubic(lt);

      // Rotate pivot around fold axis direction
      const axisDir = new THREE.Vector3()
        .subVectors(fold.axis.end, fold.axis.start)
        .normalize();
      panel.pivot.setRotationFromAxisAngle(axisDir, angle);
    });
  }

  dispose() {
    this.scene.remove(this._root);
    this._panels.forEach(p => {
      p.mesh.geometry.dispose();
    });
    this._creaseLines.forEach(({ line, geo }) => {
      this._root.remove(line);
      geo.dispose();
    });
    this._mat.dispose();
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// WireTwistEffect
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Animates N parallel wires twisting together into a cable bundle.
 *
 * At t=0 the wires run parallel along the main path.
 * As t→1 they corkscrew around each other at the given twist rate.
 * An optional transparent sheath slides on from one end as the twist completes.
 *
 * @example
 *   const effect = new WireTwistEffect(scene, {
 *     path: new THREE.CatmullRomCurve3([...]),
 *     wires: [{ color: 0xff0000 }, { color: 0x0000ff }, { color: 0xffffff }],
 *     twistRate: 6,     // full rotations per metre of path
 *     bundleRadius: 0.006,
 *   });
 *   effect.update(t);
 */
export class WireTwistEffect {
  /**
   * @param {THREE.Scene} scene
   * @param {object} options
   * @param {THREE.CatmullRomCurve3} options.path   Main cable path
   * @param {object[]} options.wires                Array of wire definitions
   * @param {number|string} options.wires[].color   Wire colour
   * @param {number} [options.twistRate=5]          Full turns per metre
   * @param {number} [options.bundleRadius=0.005]   Orbit radius of each wire (m)
   * @param {number} [options.wireRadius=0.0015]    Individual wire tube radius (m)
   * @param {number} [options.pathSamples=80]       Points sampled along path
   * @param {boolean} [options.sheath=true]         Add transparent outer sheath
   */
  constructor(scene, options = {}) {
    this.scene        = scene;
    this.mainPath     = options.path;
    this.wireDefs     = options.wires     ?? [{ color: 0xff6b35 }, { color: 0x7b5cfa }];
    this.twistRate    = options.twistRate    ?? 5;
    this.bundleRadius = options.bundleRadius ?? 0.005;
    this.wireRadius   = options.wireRadius   ?? 0.0015;
    this.pathSamples  = options.pathSamples  ?? 80;
    this.pathLength   = this.mainPath.getLength();

    this._group = new THREE.Group();
    this.scene.add(this._group);

    // Build one tube mesh per wire
    this._wires = this.wireDefs.map((def, i) => {
      const mat = new THREE.MeshStandardMaterial({
        color:     def.color ?? 0xffffff,
        roughness: 0.6,
        metalness: 0.1,
      });
      // Start with a dummy curve — updated each frame
      const curve = this._buildHelixCurve(i, 0);
      const geo   = new THREE.TubeGeometry(curve, this.pathSamples, this.wireRadius, 6, false);
      const mesh  = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      this._group.add(mesh);
      return { mat, geo, mesh, index: i };
    });

    // Optional outer sheath (slides on during animation)
    if (options.sheath !== false) {
      const sheathMat = new THREE.MeshStandardMaterial({
        color:       0x222230,
        roughness:   0.5,
        metalness:   0.1,
        transparent: true,
        opacity:     0.45,
        side:        THREE.DoubleSide,
      });
      const sheathR = this.bundleRadius + this.wireRadius * 2.5;
      // Sheath starts with zero length; we rebuild it each update
      const sheathCurve = this.mainPath;
      this._sheathGeo  = new THREE.TubeGeometry(sheathCurve, this.pathSamples, sheathR, 16, false);
      this._sheathMesh = new THREE.Mesh(this._sheathGeo, sheathMat);
      this._sheathMesh.visible = false;
      this._sheathMat  = sheathMat;
      this._group.add(this._sheathMesh);
    }
  }

  /**
   * Build the helical CatmullRomCurve3 for wire[index] at given twist factor.
   * @param {number} wireIndex
   * @param {number} twistFactor  0 = no twist (parallel), 1 = full twist
   * @returns {THREE.CatmullRomCurve3}
   */
  _buildHelixCurve(wireIndex, twistFactor) {
    const n     = this.wireDefs.length;
    const pts   = [];
    const phaseOffset = (wireIndex / n) * Math.PI * 2;

    for (let s = 0; s <= this.pathSamples; s++) {
      const u = s / this.pathSamples;
      const pt = new THREE.Vector3();
      this.mainPath.getPoint(u, pt);

      if (twistFactor > 0) {
        // Build a local frame (tangent, normal, binormal)
        const tangent  = this.mainPath.getTangent(u).normalize();
        const up       = Math.abs(tangent.y) < 0.99
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(1, 0, 0);
        const normal   = new THREE.Vector3().crossVectors(up, tangent).normalize();
        const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

        // Helical orbit angle
        const helixAngle = phaseOffset
          + twistFactor * this.twistRate * this.pathLength * u * Math.PI * 2;

        pt.addScaledVector(normal,   Math.cos(helixAngle) * this.bundleRadius * twistFactor);
        pt.addScaledVector(binormal, Math.sin(helixAngle) * this.bundleRadius * twistFactor);
      }

      pts.push(pt);
    }

    return new THREE.CatmullRomCurve3(pts);
  }

  /**
   * @param {number} t  0 = parallel wires, 1 = fully twisted bundle
   */
  update(t) {
    t = Math.max(0, Math.min(1, t));
    const ease = _easeInOutCubic(t);

    // Rebuild each wire's tube geometry along its updated helix
    this._wires.forEach(wire => {
      const curve = this._buildHelixCurve(wire.index, ease);
      // Dispose old geo and rebuild — cheap for small pathSamples
      wire.geo.dispose();
      wire.geo = new THREE.TubeGeometry(curve, this.pathSamples, this.wireRadius, 6, false);
      wire.mesh.geometry = wire.geo;
    });

    // Sheath slides on from t=0.6 onwards
    if (this._sheathMesh) {
      const sheathT = _clamp01((t - 0.6) / 0.4);
      this._sheathMesh.visible = sheathT > 0;
      if (sheathT > 0) {
        // Rebuild sheath as a partial tube (clamp path to sheathT fraction)
        const sheathR = this.bundleRadius + this.wireRadius * 2.5;
        this._sheathGeo.dispose();

        // Sub-sample the path up to sheathT
        const subPts = [];
        for (let s = 0; s <= Math.floor(this.pathSamples * sheathT); s++) {
          const u = s / this.pathSamples;
          const pt = new THREE.Vector3();
          this.mainPath.getPoint(u, pt);
          subPts.push(pt);
        }
        if (subPts.length >= 2) {
          const subCurve = new THREE.CatmullRomCurve3(subPts);
          this._sheathGeo = new THREE.TubeGeometry(
            subCurve, Math.max(2, Math.floor(this.pathSamples * sheathT)), sheathR, 16, false
          );
          this._sheathMesh.geometry = this._sheathGeo;
        }
        this._sheathMat.opacity = 0.45 * sheathT;
      }
    }
  }

  dispose() {
    this.scene.remove(this._group);
    this._wires.forEach(w => { w.geo.dispose(); w.mat.dispose(); });
    if (this._sheathGeo)  this._sheathGeo.dispose();
    if (this._sheathMat)  this._sheathMat.dispose();
  }
}


// ── shared helpers ────────────────────────────────────────────────────────────

function _clamp01(v)       { return Math.max(0, Math.min(1, v)); }
function _easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }
