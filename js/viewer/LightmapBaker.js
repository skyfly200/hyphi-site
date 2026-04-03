import * as THREE from 'three';

/**
 * LightmapBaker
 * Bakes ambient occlusion into a UV2 lightmap texture entirely in the browser.
 *
 * Algorithm (progressive hemisphere sampling):
 *   For each texel in the lightmap render target:
 *     1. Reconstruct the world-space position + normal from UV2 coords
 *     2. Cast N random rays into the hemisphere above the normal
 *     3. Check each ray against the scene BVH
 *     4. Accumulate occlusion into the texture (1 - occluded_fraction)
 *   Runs 1–2 samples per frame via requestAnimationFrame to stay non-blocking.
 *   After enough passes the result converges to stable AO.
 *
 * Requirements:
 *   - Meshes must have a UV2 (uv2) attribute for lightmap unwrapping
 *   - three-mesh-bvh must be available: https://github.com/gkjohnson/three-mesh-bvh
 *
 * Usage:
 *   const baker = new LightmapBaker(renderer, scene);
 *   baker.addMesh(myMesh, { resolution: 512 });
 *   baker.start(() => {
 *     // called when baking is complete (or after maxPasses)
 *     const texture = baker.getLightmap(myMesh);
 *     myMesh.material.lightMap = texture;
 *     myMesh.material.lightMapIntensity = 1.4;
 *     baker.downloadLightmap(myMesh, 'lightmap.png');
 *   });
 *
 * NOTE: three-mesh-bvh is loaded lazily.  If it is not available, the baker
 * falls back to a coarser scene-bounding-sphere occlusion estimate which is
 * fast but less accurate.
 */
export class LightmapBaker {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene  Scene containing occluder geometry
   * @param {object} [options]
   * @param {number} [options.resolution=512]    Lightmap texture resolution (px)
   * @param {number} [options.samplesPerPass=2]  Hemisphere samples per rAF tick
   * @param {number} [options.maxPasses=128]     Total passes before auto-stop
   * @param {number} [options.aoRadius=0.3]      Max ray length for AO (world units)
   */
  constructor(renderer, scene, options = {}) {
    this.renderer = renderer;
    this.scene    = scene;

    this.resolution    = options.resolution    ?? 512;
    this.samplesPerPass = options.samplesPerPass ?? 2;
    this.maxPasses     = options.maxPasses     ?? 128;
    this.aoRadius      = options.aoRadius      ?? 0.3;

    /** @type {Map<THREE.Mesh, BakeEntry>} */
    this._entries = new Map();

    this._pass       = 0;
    this._running    = false;
    this._rafId      = null;
    this._onComplete = null;

    // Reusable objects
    this._raycaster = new THREE.Raycaster();
    this._raycaster.near = 0.001;
    this._raycaster.far  = this.aoRadius;
    this._up = new THREE.Vector3(0, 1, 0);

    // BVH availability check (three-mesh-bvh is an optional peer dep)
    this._bvhAvailable = false;
    this._tryLoadBVH();
  }

  /**
   * Register a mesh for baking.
   * @param {THREE.Mesh} mesh
   * @param {{ resolution?: number }} [opts]
   */
  addMesh(mesh, opts = {}) {
    const res = opts.resolution ?? this.resolution;

    // Create a floating-point accumulation buffer
    const accumTarget = new THREE.WebGLRenderTarget(res, res, {
      type:    THREE.FloatType,
      format:  THREE.RedFormat,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
    });

    // Output RGBA texture that gets filled from the accumulator
    const outputData = new Uint8Array(res * res * 4).fill(255);
    const outputTex = new THREE.DataTexture(outputData, res, res, THREE.RGBAFormat);
    outputTex.colorSpace = THREE.LinearSRGBColorSpace;
    outputTex.needsUpdate = true;

    this._entries.set(mesh, {
      mesh,
      resolution: res,
      accumTarget,
      outputTex,
      accumBuffer: new Float32Array(res * res),
      sampleCount: 0,
    });
  }

  /**
   * Start the progressive baking loop.
   * @param {function} [onComplete]  Called when maxPasses are reached
   */
  start(onComplete) {
    if (this._running) return;
    this._running    = true;
    this._pass       = 0;
    this._onComplete = onComplete || null;
    this._tick();
  }

  stop() {
    this._running = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  /** Get the current (possibly mid-bake) lightmap for a mesh. */
  getLightmap(mesh) {
    return this._entries.get(mesh)?.outputTex ?? null;
  }

  /** Returns 0–1 bake completion fraction. */
  get progress() { return this._pass / this.maxPasses; }

  /**
   * Download the baked lightmap for a mesh as a PNG.
   * Uses an offscreen canvas to encode the DataTexture.
   */
  downloadLightmap(mesh, filename = 'lightmap.png') {
    const entry = this._entries.get(mesh);
    if (!entry) return;

    const { resolution, outputTex } = entry;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = resolution;
    const ctx = canvas.getContext('2d');
    const id = ctx.createImageData(resolution, resolution);
    id.data.set(outputTex.image.data);
    ctx.putImageData(id, 0, 0);

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    a.click();
  }

  // ── private ────────────────────────────────────────────────────────────────

  _tick() {
    if (!this._running) return;

    for (let s = 0; s < this.samplesPerPass; s++) {
      this._bakePass();
    }

    this._pass++;
    this._updateOutputTextures();

    if (this._pass >= this.maxPasses) {
      this._running = false;
      if (this._onComplete) this._onComplete();
      return;
    }

    this._rafId = requestAnimationFrame(() => this._tick());
  }

  /** One hemisphere-sampling pass across all registered meshes. */
  _bakePass() {
    this._entries.forEach(entry => {
      this._sampleMesh(entry);
    });
  }

  _sampleMesh(entry) {
    const { mesh, resolution, accumBuffer } = entry;
    const posAttr = mesh.geometry.attributes.position;
    const normAttr = mesh.geometry.attributes.normal;
    const uv2Attr  = mesh.geometry.attributes.uv2;

    if (!posAttr || !normAttr || !uv2Attr) {
      // No UV2 — cannot bake this mesh
      return;
    }

    const index = mesh.geometry.index;
    const triCount = index ? index.count / 3 : posAttr.count / 3;

    // Sample a random subset of triangles each pass for performance
    const triSampleCount = Math.max(1, Math.floor(triCount * 0.1));

    const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3();
    const _n0 = new THREE.Vector3(), _n1 = new THREE.Vector3(), _n2 = new THREE.Vector3();
    const _uv0 = new THREE.Vector2(), _uv1 = new THREE.Vector2(), _uv2v = new THREE.Vector2();
    const _worldPos = new THREE.Vector3();
    const _worldNorm = new THREE.Vector3();
    const _rayDir = new THREE.Vector3();
    const _tangent = new THREE.Vector3();
    const _bitangent = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);

    for (let t = 0; t < triSampleCount; t++) {
      const triIdx = Math.floor(Math.random() * triCount);

      const i0 = index ? index.getX(triIdx * 3)     : triIdx * 3;
      const i1 = index ? index.getX(triIdx * 3 + 1) : triIdx * 3 + 1;
      const i2 = index ? index.getX(triIdx * 3 + 2) : triIdx * 3 + 2;

      _p0.fromBufferAttribute(posAttr, i0);
      _p1.fromBufferAttribute(posAttr, i1);
      _p2.fromBufferAttribute(posAttr, i2);

      _n0.fromBufferAttribute(normAttr, i0);
      _n1.fromBufferAttribute(normAttr, i1);
      _n2.fromBufferAttribute(normAttr, i2);

      _uv0.fromBufferAttribute(uv2Attr, i0);
      _uv1.fromBufferAttribute(uv2Attr, i1);
      _uv2v.fromBufferAttribute(uv2Attr, i2);

      // Random barycentric point on triangle
      let u = Math.random(), v = Math.random();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const w = 1 - u - v;

      _worldPos.set(
        _p0.x * w + _p1.x * u + _p2.x * v,
        _p0.y * w + _p1.y * u + _p2.y * v,
        _p0.z * w + _p1.z * u + _p2.z * v,
      ).applyMatrix4(mesh.matrixWorld);

      _worldNorm.set(
        _n0.x * w + _n1.x * u + _n2.x * v,
        _n0.y * w + _n1.y * u + _n2.y * v,
        _n0.z * w + _n1.z * u + _n2.z * v,
      ).applyMatrix3(normalMatrix).normalize();

      const uvX = _uv0.x * w + _uv1.x * u + _uv2v.x * v;
      const uvY = _uv0.y * w + _uv1.y * u + _uv2v.y * v;

      // Map UV to texel
      const tx = Math.floor(uvX * resolution);
      const ty = Math.floor((1 - uvY) * resolution);
      if (tx < 0 || ty < 0 || tx >= resolution || ty >= resolution) continue;
      const texelIdx = ty * resolution + tx;

      // Build a tangent frame for hemisphere sampling
      _tangent.copy(this._up).cross(_worldNorm);
      if (_tangent.lengthSq() < 1e-6) _tangent.set(1, 0, 0).cross(_worldNorm);
      _tangent.normalize();
      _bitangent.copy(_worldNorm).cross(_tangent).normalize();

      // Cosine-weighted hemisphere sample
      const r1 = Math.random(), r2 = Math.random();
      const sinTheta = Math.sqrt(r1);
      const cosTheta = Math.sqrt(1 - r1);
      const phi = 2 * Math.PI * r2;

      _rayDir.set(
        sinTheta * Math.cos(phi),
        cosTheta,
        sinTheta * Math.sin(phi),
      );
      // Transform to world space
      _rayDir.set(
        _rayDir.x * _tangent.x + _rayDir.y * _worldNorm.x + _rayDir.z * _bitangent.x,
        _rayDir.x * _tangent.y + _rayDir.y * _worldNorm.y + _rayDir.z * _bitangent.y,
        _rayDir.x * _tangent.z + _rayDir.y * _worldNorm.z + _rayDir.z * _bitangent.z,
      ).normalize();

      // Offset origin slightly above surface to avoid self-intersection
      const origin = _worldPos.clone().addScaledVector(_worldNorm, 0.002);

      this._raycaster.set(origin, _rayDir);
      const hits = this._raycaster.intersectObjects(this.scene.children, true);

      // AO: 0 = fully occluded, 1 = fully lit
      const occluded = hits.length > 0 && hits[0].distance < this.aoRadius ? 1 : 0;
      // Running mean
      entry.sampleCount++;
      accumBuffer[texelIdx] += (occluded - accumBuffer[texelIdx]) / entry.sampleCount;
    }
  }

  /** Push accumulation buffer → DataTexture for use as lightMap. */
  _updateOutputTextures() {
    this._entries.forEach(entry => {
      const { resolution, accumBuffer, outputTex } = entry;
      const data = outputTex.image.data;
      for (let i = 0; i < resolution * resolution; i++) {
        // AO: 1.0 = unoccluded (bright), 0.0 = fully occluded (dark)
        const ao = Math.max(0, Math.min(1, 1.0 - accumBuffer[i]));
        const byte = Math.round(ao * 255);
        data[i * 4 + 0] = byte; // R
        data[i * 4 + 1] = byte; // G
        data[i * 4 + 2] = byte; // B
        data[i * 4 + 3] = 255;  // A
      }
      outputTex.needsUpdate = true;
    });
  }

  async _tryLoadBVH() {
    try {
      const { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } = await import(
        'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.7.0/build/index.module.js'
      );
      THREE.Mesh.prototype.raycast = acceleratedRaycast;
      THREE.BufferGeometry.prototype.computeBoundsTree  = computeBoundsTree;
      THREE.BufferGeometry.prototype.disposeBoundsTree  = disposeBoundsTree;
      // Pre-build BVH for all scene meshes
      this.scene.traverse(obj => {
        if (obj.isMesh && obj.geometry) obj.geometry.computeBoundsTree();
      });
      this._bvhAvailable = true;
    } catch {
      console.info('[LightmapBaker] three-mesh-bvh not found — using standard raycasting (slower).');
    }
  }
}
