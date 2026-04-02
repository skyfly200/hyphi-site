import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/**
 * AssetLoader
 * Loads product parts from GLB files (with Draco compression support) and
 * places them in the scene according to assembly.json part definitions.
 *
 * Supports:
 *   - Live model swap: swapModel(partId, glbUrl) replaces a part's geometry
 *   - Live texture swap: swapTexture(partId, textureUrl, mapType) replaces a texture
 *   - Fallback: if a model URL 404s, the placeholder geometry remains untouched
 *
 * After loading, each part mesh is named by its assembly part id so other
 * systems (ExplodedView, LEDSystem) can find them by name.
 */
export class AssetLoader {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Group} productGroup  - root group all product parts are added to
   */
  constructor(scene, productGroup) {
    this.scene = scene;
    this.productGroup = productGroup;

    /** @type {Map<string, THREE.Object3D>} part id → mesh/group */
    this.partObjects = new Map();

    this._gltfLoader = new GLTFLoader();

    // Set up Draco for compressed GLBs
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    this._gltfLoader.setDRACOLoader(draco);

    this._textureLoader = new THREE.TextureLoader();
  }

  /**
   * Load all parts defined in assembly data.
   * Parts that have no model URL (or whose URL fails) are skipped gracefully —
   * placeholder geometry added by PlaceholderProduct.js remains in place.
   *
   * @param {object} assemblyData  parsed assembly.json
   * @param {function} onComplete  called once all parts have been processed
   */
  load(assemblyData, onComplete) {
    const parts = assemblyData.parts || [];
    let pending = 0;

    const done = () => {
      pending--;
      if (pending === 0 && onComplete) onComplete();
    };

    parts.forEach(partDef => {
      if (!partDef.model) return; // no model URL — rely on placeholder

      pending++;
      this._gltfLoader.load(
        partDef.model,
        (gltf) => {
          const root = gltf.scene;
          root.name = partDef.id;
          this._applyPartTransform(root, partDef);
          this._applyPartMaterial(root, partDef.material);

          // Replace placeholder if one exists
          const existing = this.partObjects.get(partDef.id);
          if (existing) {
            this.productGroup.remove(existing);
          }

          this.productGroup.add(root);
          this.partObjects.set(partDef.id, root);
          done();
        },
        undefined,
        (err) => {
          // Model not found — placeholder geometry stays, just continue
          console.warn(`[AssetLoader] Could not load model for "${partDef.id}": ${err.message || err}`);
          done();
        }
      );
    });

    if (pending === 0 && onComplete) onComplete();
  }

  /**
   * Register a placeholder object (created by PlaceholderProduct.js) so that
   * swapModel() can replace it later.
   * @param {string} partId
   * @param {THREE.Object3D} object
   */
  registerPlaceholder(partId, object) {
    this.partObjects.set(partId, object);
  }

  /**
   * Replace a part's mesh with a new GLB at runtime.
   * Material and transform from the original part definition are preserved.
   * @param {string} partId
   * @param {string} glbUrl
   * @param {object} [partDef]  optional assembly part definition for transforms
   */
  swapModel(partId, glbUrl, partDef = null) {
    this._gltfLoader.load(
      glbUrl,
      (gltf) => {
        const root = gltf.scene;
        root.name = partId;

        const existing = this.partObjects.get(partId);
        if (existing) {
          // Carry over position, rotation, scale from old object
          root.position.copy(existing.position);
          root.rotation.copy(existing.rotation);
          root.scale.copy(existing.scale);

          if (partDef) this._applyPartMaterial(root, partDef.material);
          this.productGroup.remove(existing);
        }

        if (partDef) this._applyPartTransform(root, partDef);

        this.productGroup.add(root);
        this.partObjects.set(partId, root);
      },
      undefined,
      (err) => console.error(`[AssetLoader] swapModel failed for "${partId}":`, err)
    );
  }

  /**
   * Replace a specific texture map on a part's material at runtime.
   * Useful for live colour/finish customisation.
   * @param {string} partId
   * @param {string} textureUrl
   * @param {'map'|'normalMap'|'roughnessMap'|'metalnessMap'|'emissiveMap'|'lightMap'} mapType
   */
  swapTexture(partId, textureUrl, mapType = 'map') {
    const object = this.partObjects.get(partId);
    if (!object) {
      console.warn(`[AssetLoader] swapTexture: part "${partId}" not found`);
      return;
    }

    this._textureLoader.load(
      textureUrl,
      (texture) => {
        texture.colorSpace = mapType === 'map' || mapType === 'emissiveMap'
          ? THREE.SRGBColorSpace
          : THREE.LinearSRGBColorSpace;

        object.traverse((child) => {
          if (child.isMesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => {
              if (m[mapType] !== undefined) {
                const old = m[mapType];
                m[mapType] = texture;
                m.needsUpdate = true;
                if (old) old.dispose();
              }
            });
          }
        });
      },
      undefined,
      (err) => console.error(`[AssetLoader] swapTexture failed for "${partId}":`, err)
    );
  }

  /** Get a registered part object by id. */
  getPart(partId) {
    return this.partObjects.get(partId) || null;
  }

  // ── internals ───────────────────────────────────────────────────────────────

  _applyPartTransform(object, partDef) {
    const [px, py, pz] = partDef.assembledPosition || [0,0,0];
    const [rx, ry, rz] = partDef.assembledRotation || [0,0,0];
    object.position.set(px, py, pz);
    object.rotation.set(rx, ry, rz);
  }

  _applyPartMaterial(object, matDef) {
    if (!matDef) return;
    object.traverse((child) => {
      if (!child.isMesh) return;
      const m = new THREE.MeshStandardMaterial({
        color:            matDef.color     || '#888888',
        roughness:        matDef.roughness ?? 0.5,
        metalness:        matDef.metalness ?? 0,
        transparent:      matDef.transparent ?? false,
        opacity:          matDef.opacity   ?? 1,
        side:             matDef.transparent ? THREE.DoubleSide : THREE.FrontSide,
      });
      if (matDef.emissive)          m.emissive.set(matDef.emissive);
      if (matDef.emissiveIntensity) m.emissiveIntensity = matDef.emissiveIntensity;
      child.material = m;
      child.castShadow    = true;
      child.receiveShadow = true;
    });
  }
}
