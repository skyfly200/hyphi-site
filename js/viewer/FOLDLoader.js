import * as THREE from 'three';

/**
 * FOLDLoader
 * Parses the FOLD file format (https://github.com/edemaine/fold) and produces:
 *   1. A THREE.BufferGeometry representing the flat/folded mesh
 *   2. An array of fold definitions compatible with OrigamiFoldEffect
 *   3. Metadata (author, title, units, description) for documentation
 *
 * FOLD edge assignments used:
 *   "M" = Mountain fold  (folds toward viewer)
 *   "V" = Valley fold    (folds away from viewer)
 *   "B" = Border/boundary edge
 *   "F" = Flat (no fold)
 *   "U" = Unassigned
 *
 * Usage:
 *   const result = await FOLDLoader.load('/data/glow-flora/petal.fold');
 *   const effect = new OrigamiFoldEffect(scene, {
 *     ...result.origamiOptions,
 *     color: 0xff6b35,
 *   });
 *   // in scroll update:
 *   effect.update(t);
 *
 * Or imperatively:
 *   const fold = await FOLDLoader.load('/data/glow-flora/petal.fold');
 *   console.log(fold.meta);   // { title, author, description, units }
 *   console.log(fold.folds);  // array of fold definitions
 *   console.log(fold.geometry); // THREE.BufferGeometry
 */
export class FOLDLoader {
  /**
   * Load and parse a .fold file from a URL.
   * @param {string} url
   * @returns {Promise<FOLDResult>}
   */
  static async load(url) {
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`FOLDLoader: failed to fetch "${url}" (${res.status})`);
    const data = await res.json();
    return FOLDLoader.parse(data);
  }

  /**
   * Parse a FOLD JSON object directly.
   * Supports single-frame and multi-frame FOLD files.
   * For multi-frame files, the first frame with geometry is used.
   * @param {object} foldData  Parsed FOLD JSON
   * @returns {FOLDResult}
   */
  static parse(foldData) {
    // Resolve the active frame (FOLD allows frames array for animation)
    const frame = FOLDLoader._resolveFrame(foldData);

    const meta     = FOLDLoader._parseMeta(foldData, frame);
    const geometry = FOLDLoader._buildGeometry(frame);
    const folds    = FOLDLoader._extractFolds(frame);
    const frames   = FOLDLoader._extractAnimationFrames(foldData);

    return {
      meta,
      geometry,
      folds,
      frames,
      /** Ready-to-use options object for OrigamiFoldEffect */
      origamiOptions: { folds },
      /** Raw resolved frame data for custom use */
      raw: frame,
    };
  }

  // ── frame resolution ────────────────────────────────────────────────────────

  static _resolveFrame(data) {
    // If root has geometry, use it directly
    if (data.vertices_coords) return data;
    // Otherwise look in frames array
    const frames = data.frames || [];
    for (const f of frames) {
      if (f.vertices_coords) return FOLDLoader._mergeFrame(data, f);
    }
    // Fall back to root even without geometry (will produce empty result)
    return data;
  }

  static _mergeFrame(root, frame) {
    // Child frame inherits root properties unless overridden
    return { ...root, ...frame };
  }

  // ── metadata ────────────────────────────────────────────────────────────────

  static _parseMeta(root, frame) {
    return {
      title:       root.file_title       || frame.file_title       || '',
      author:      root.file_author      || frame.file_author      || '',
      description: root.file_description || frame.file_description || '',
      classes:     root.file_classes     || frame.file_classes     || [],
      units:       frame.vertices_units  || root.vertices_units    || 'unit',
      frameCount:  (root.frames || []).length,
    };
  }

  // ── geometry ────────────────────────────────────────────────────────────────

  static _buildGeometry(frame) {
    const coords = frame.vertices_coords || [];
    const faces  = frame.faces_vertices  || [];

    if (!coords.length || !faces.length) return new THREE.BufferGeometry();

    // Triangulate faces (FOLD faces can be arbitrary polygons)
    const positions = [];
    const indices   = [];
    const uvs       = [];
    let   vertexIdx = 0;

    // Build a flat vertex buffer — duplicate verts per face for sharp normals
    faces.forEach(faceVerts => {
      const fLen = faceVerts.length;
      if (fLen < 3) return;

      // Compute face centre for UV origin
      let cx = 0, cy = 0;
      faceVerts.forEach(vi => { cx += coords[vi][0]; cy += coords[vi][1]; });
      cx /= fLen; cy /= fLen;
      const spread = FOLDLoader._faceSpread(coords, faceVerts);

      // Fan triangulation from vertex 0
      const base = vertexIdx;
      faceVerts.forEach((vi, i) => {
        const [x, y, z = 0] = coords[vi];
        positions.push(x, y, z);
        // Simple planar UV
        uvs.push((x - cx) / (spread || 1) + 0.5, (y - cy) / (spread || 1) + 0.5);
        vertexIdx++;
      });
      for (let i = 1; i < fLen - 1; i++) {
        indices.push(base, base + i, base + i + 1);
      }
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  static _faceSpread(coords, faceVerts) {
    // Approximate bounding radius of face
    let maxD = 0;
    const cx = faceVerts.reduce((s, vi) => s + coords[vi][0], 0) / faceVerts.length;
    const cy = faceVerts.reduce((s, vi) => s + coords[vi][1], 0) / faceVerts.length;
    faceVerts.forEach(vi => {
      const dx = coords[vi][0] - cx, dy = coords[vi][1] - cy;
      maxD = Math.max(maxD, Math.sqrt(dx*dx + dy*dy));
    });
    return maxD * 2;
  }

  // ── fold extraction ─────────────────────────────────────────────────────────

  static _extractFolds(frame) {
    const coords      = frame.vertices_coords  || [];
    const edgeVerts   = frame.edges_vertices   || [];
    const assignments = frame.edges_assignment || [];
    const foldAngles  = frame.edges_foldAngle  || [];
    const facesVerts  = frame.faces_vertices   || [];

    const folds = [];

    edgeVerts.forEach((evPair, ei) => {
      const assign = assignments[ei] || 'U';
      if (assign !== 'M' && assign !== 'V') return; // only mountain/valley

      const [vi0, vi1] = evPair;
      const c0 = coords[vi0], c1 = coords[vi1];
      if (!c0 || !c1) return;

      const start = new THREE.Vector3(c0[0], c0[1], c0[2] || 0);
      const end   = new THREE.Vector3(c1[0], c1[1], c1[2] || 0);
      const axis  = new THREE.Line3(start, end);

      // Determine target angle
      // FOLD stores fold angles in degrees; mountain = negative (toward viewer)
      let targetAngle = foldAngles[ei] != null
        ? THREE.MathUtils.degToRad(foldAngles[ei])
        : (assign === 'M' ? -Math.PI : Math.PI); // default flat-fold

      // Find which face indices share this edge
      const sharedFaces = FOLDLoader._facesForEdge(vi0, vi1, facesVerts);

      // Stagger: later edges fold later
      const staggerStep = 0.15;
      const startT = Math.min(ei * staggerStep * 0.5, 0.7);
      const endT   = Math.min(startT + 0.45, 1.0);

      folds.push({
        axis,
        angle:      targetAngle,
        assignment: assign,
        edgeIndex:  ei,
        faceIndices: sharedFaces,
        startT,
        endT,
      });
    });

    // Sort by edge index so stagger is deterministic
    folds.sort((a, b) => a.edgeIndex - b.edgeIndex);
    return folds;
  }

  static _facesForEdge(vi0, vi1, facesVerts) {
    const result = [];
    facesVerts.forEach((fv, fi) => {
      const has0 = fv.includes(vi0);
      const has1 = fv.includes(vi1);
      if (has0 && has1) result.push(fi);
    });
    return result;
  }

  // ── animation frames ────────────────────────────────────────────────────────

  /**
   * Extract multi-frame animation data for fold-sequence playback.
   * Each frame in the FOLD `frames` array can override `edges_foldAngle`,
   * representing a different fold state.
   * Returns an array of per-frame fold-angle arrays (degrees).
   */
  static _extractAnimationFrames(data) {
    if (!data.frames || !data.frames.length) return [];
    return data.frames.map(f => f.edges_foldAngle || []);
  }

  // ── utility ─────────────────────────────────────────────────────────────────

  /**
   * Convert a flat 2D FOLD pattern to Three.js world space.
   * Applies a scale factor (FOLD "unit" → metres) and an optional transform.
   * @param {object} foldData
   * @param {number} [scale=1]         Multiply all coordinates by this
   * @param {THREE.Matrix4} [matrix]   Additional transform
   * @returns {object}  New foldData with transformed vertices_coords
   */
  static transform(foldData, scale = 1, matrix = null) {
    const coords  = (foldData.vertices_coords || []).map(([x, y, z = 0]) => {
      let v = new THREE.Vector3(x * scale, y * scale, z * scale);
      if (matrix) v.applyMatrix4(matrix);
      return [v.x, v.y, v.z];
    });
    return { ...foldData, vertices_coords: coords };
  }

  /**
   * Export a minimal FOLD file from OrigamiFoldEffect fold definitions.
   * Useful for round-tripping: design in viewer → save as .fold for documentation.
   * @param {object[]} folds   Array from OrigamiFoldEffect
   * @param {object}   meta    { title, author, description }
   * @returns {object}  FOLD JSON object (JSON.stringify to save)
   */
  static exportFromFolds(folds, meta = {}) {
    const vertices_coords  = [];
    const edges_vertices   = [];
    const edges_assignment = [];
    const edges_foldAngle  = [];
    const vertMap = new Map();

    const addVertex = (v) => {
      const key = `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`;
      if (!vertMap.has(key)) { vertMap.set(key, vertices_coords.length); vertices_coords.push([v.x, v.y, v.z]); }
      return vertMap.get(key);
    };

    folds.forEach(fold => {
      const i0 = addVertex(fold.axis.start);
      const i1 = addVertex(fold.axis.end);
      edges_vertices.push([i0, i1]);
      edges_assignment.push(fold.assignment || 'F');
      edges_foldAngle.push(THREE.MathUtils.radToDeg(fold.angle || 0));
    });

    return {
      file_spec:    1.1,
      file_creator: 'Hyphi FOLDLoader',
      file_title:       meta.title       || '',
      file_author:      meta.author      || '',
      file_description: meta.description || '',
      file_classes: ['singleModel'],
      vertices_coords,
      edges_vertices,
      edges_assignment,
      edges_foldAngle,
    };
  }
}

/**
 * @typedef {object} FOLDResult
 * @property {{ title:string, author:string, description:string, units:string, frameCount:number }} meta
 * @property {THREE.BufferGeometry} geometry   Flat mesh geometry
 * @property {FoldDef[]} folds                 Fold definitions for OrigamiFoldEffect
 * @property {number[][]} frames               Per-frame fold angles (degrees) for animation
 * @property {{ folds: FoldDef[] }} origamiOptions  Drop into OrigamiFoldEffect constructor
 * @property {object} raw                      Raw resolved FOLD frame data
 */

/**
 * @typedef {object} FoldDef
 * @property {THREE.Line3} axis
 * @property {number} angle        Target fold angle (radians)
 * @property {'M'|'V'} assignment
 * @property {number} edgeIndex
 * @property {number[]} faceIndices
 * @property {number} startT
 * @property {number} endT
 */
