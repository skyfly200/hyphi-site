import * as THREE from 'three';

/**
 * ExplodedView
 * Animates registered part meshes between their assembled positions and
 * their exploded positions.  factor=0 → assembled, factor=1 → fully exploded.
 *
 * Parts can be registered from the assembly.json definition OR from any Three.js
 * Object3D already in the scene.  explodeOffset and explodeRotation are applied
 * on top of the assembled pose, so assembled values stay authoritative.
 */
export class ExplodedView {
  constructor() {
    /** @type {Map<string, ExplodePart>} */
    this.parts = new Map();
    this._factor = 0;
  }

  /**
   * Register a mesh/group with its explode parameters.
   * @param {string} id
   * @param {THREE.Object3D} object
   * @param {number[]} explodeOffset  [x,y,z] in world units
   * @param {number[]} explodeRotation [x,y,z] euler radians added on top of assembled
   * @param {number} explodeOrder  0 = first to explode, higher = later
   */
  addPart(id, object, explodeOffset, explodeRotation = [0,0,0], explodeOrder = 0) {
    this.parts.set(id, {
      object,
      assembledPosition: object.position.clone(),
      assembledRotation: new THREE.Euler(
        object.rotation.x, object.rotation.y, object.rotation.z, 'XYZ'
      ),
      explodeOffset: new THREE.Vector3(...explodeOffset),
      explodeRotEuler: new THREE.Euler(...explodeRotation, 'XYZ'),
      explodeOrder,
    });
  }

  /**
   * Set the explosion factor with optional staggering per explodeOrder.
   * @param {number} factor  0–1
   */
  setFactor(factor) {
    this._factor = factor;

    // Determine the spread of explodeOrder values for stagger
    let minOrder = Infinity;
    let maxOrder = -Infinity;
    this.parts.forEach(p => {
      if (p.explodeOrder < minOrder) minOrder = p.explodeOrder;
      if (p.explodeOrder > maxOrder) maxOrder = p.explodeOrder;
    });
    const orderRange = Math.max(1, maxOrder - minOrder);

    this.parts.forEach((part) => {
      // Stagger: each explodeOrder level starts 0.12 of total factor later
      const stagger = ((part.explodeOrder - minOrder) / orderRange) * 0.25;
      const t = _clamp01((factor - stagger) / (1 - stagger));
      const ease = _easeInOutCubic(t);

      // Position: lerp assembled → assembled + offset
      part.object.position.lerpVectors(
        part.assembledPosition,
        _addVec3(part.assembledPosition, part.explodeOffset),
        ease
      );

      // Rotation: assembled + lerped additional rotation
      part.object.rotation.set(
        part.assembledRotation.x + part.explodeRotEuler.x * ease,
        part.assembledRotation.y + part.explodeRotEuler.y * ease,
        part.assembledRotation.z + part.explodeRotEuler.z * ease
      );
    });
  }

  get factor() { return this._factor; }

  /**
   * Instantly snap to a factor (skips animation — used for initial state).
   */
  snapToFactor(factor) {
    this.setFactor(factor);
  }

  /**
   * Clear all registered parts (call before re-loading a product).
   */
  clear() {
    this.parts.clear();
    this._factor = 0;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function _clamp01(v) { return Math.max(0, Math.min(1, v)); }

function _easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function _addVec3(a, b) {
  return new THREE.Vector3(a.x + b.x, a.y + b.y, a.z + b.z);
}

/** @typedef {{ object: THREE.Object3D, assembledPosition: THREE.Vector3, assembledRotation: THREE.Euler, explodeOffset: THREE.Vector3, explodeRotEuler: THREE.Euler, explodeOrder: number }} ExplodePart */
