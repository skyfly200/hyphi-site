import * as THREE from 'three';

/**
 * PlaceholderProduct
 * Builds procedural Three.js geometry for Glow Flora so the viewer works
 * immediately before real GLB models are delivered.
 *
 * Each part is created as a named Object3D that matches the part IDs in
 * assembly.json.  They are registered with the AssetLoader so that
 * swapModel() can replace them with real GLBs when ready.
 *
 * Product structure (all Y-up, origin at base centre):
 *   base      – tapered aluminium housing cylinder
 *   battery   – cylindrical battery pack inside base
 *   pcb       – thin disc circuit board
 *   stem      – slender poseable stem
 *   petal-0…5 – organic extruded silicone petals
 */
export class PlaceholderProduct {
  /**
   * @param {THREE.Group} productGroup
   * @param {import('./AssetLoader.js').AssetLoader} assetLoader
   * @param {import('./ExplodedView.js').ExplodedView} explodedView
   * @param {object} assemblyData  parsed assembly.json
   */
  build(productGroup, assetLoader, explodedView, assemblyData) {
    const partMap = {};
    (assemblyData.parts || []).forEach(p => { partMap[p.id] = p; });

    // Base
    this._buildBase(productGroup, assetLoader, explodedView, partMap['base']);
    // Battery
    this._buildBattery(productGroup, assetLoader, explodedView, partMap['battery']);
    // PCB
    this._buildPCB(productGroup, assetLoader, explodedView, partMap['pcb']);
    // Stem
    this._buildStem(productGroup, assetLoader, explodedView, partMap['stem']);
    // Petals
    for (let i = 0; i < 6; i++) {
      this._buildPetal(i, productGroup, assetLoader, explodedView, partMap[`petal-${i}`]);
    }
  }

  // ── parts ──────────────────────────────────────────────────────────────────

  _buildBase(group, loader, exploded, def) {
    const geo = new THREE.CylinderGeometry(0.065, 0.072, 0.055, 32, 2, false);
    const mat = _stdMat(def.material);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = def.id;
    mesh.castShadow = mesh.receiveShadow = true;

    // Touch ring detail (thin ring around base)
    const ringGeo = new THREE.TorusGeometry(0.066, 0.003, 8, 64);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x3dffc0, roughness: 0.3, metalness: 0.8, emissive: 0x3dffc0, emissiveIntensity: 0.5 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.018;
    mesh.add(ring);

    // USB-C port notch (just a dark rectangle on the side)
    const portGeo = new THREE.BoxGeometry(0.012, 0.006, 0.004);
    const portMat = new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 1, metalness: 0 });
    const port = new THREE.Mesh(portGeo, portMat);
    port.position.set(0, -0.018, 0.066);
    mesh.add(port);

    _place(mesh, def);
    group.add(mesh);
    loader.registerPlaceholder(def.id, mesh);
    exploded.addPart(def.id, mesh, def.explodeOffset, def.explodeRotation || [0,0,0], def.explodeOrder);
  }

  _buildBattery(group, loader, exploded, def) {
    // Two 18650 cells side by side
    const cellGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.065, 16);
    const cellMat = _stdMat(def.material);

    const container = new THREE.Group();
    container.name = def.id;

    [-0.012, 0.012].forEach(xOffset => {
      const cell = new THREE.Mesh(cellGeo, cellMat);
      cell.castShadow = true;
      cell.position.set(xOffset, 0, 0);
      container.add(cell);
    });

    // Shrink wrap
    const wrapGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.064, 32, 1, false);
    const wrapMat = new THREE.MeshStandardMaterial({ color: 0x1a0e00, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.7 });
    const wrap = new THREE.Mesh(wrapGeo, wrapMat);
    container.add(wrap);

    _place(container, def);
    group.add(container);
    loader.registerPlaceholder(def.id, container);
    exploded.addPart(def.id, container, def.explodeOffset, def.explodeRotation || [0,0,0], def.explodeOrder);
  }

  _buildPCB(group, loader, exploded, def) {
    // Main board: thin disc
    const boardGeo = new THREE.CylinderGeometry(0.058, 0.058, 0.002, 32);
    const boardMat = _stdMat(def.material);
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.castShadow = board.receiveShadow = true;
    board.name = def.id;

    // MCU chip
    const chipGeo = new THREE.BoxGeometry(0.012, 0.002, 0.008);
    const chipMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.6 });
    const chip = new THREE.Mesh(chipGeo, chipMat);
    chip.position.set(-0.012, 0.002, 0.008);
    board.add(chip);

    // Antenna trace line
    const antGeo = new THREE.BoxGeometry(0.022, 0.001, 0.001);
    const antMat = new THREE.MeshStandardMaterial({ color: 0xc0a020, roughness: 0.3, metalness: 0.9 });
    const ant = new THREE.Mesh(antGeo, antMat);
    ant.position.set(-0.012, 0.002, 0.016);
    board.add(ant);

    // LED strip connectors (6 small yellow pads)
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const r = 0.042;
      const padGeo = new THREE.BoxGeometry(0.005, 0.001, 0.003);
      const padMat = new THREE.MeshStandardMaterial({ color: 0xc0a020, roughness: 0.2, metalness: 0.95 });
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.position.set(Math.cos(angle) * r, 0.002, Math.sin(angle) * r);
      board.add(pad);
    }

    _place(board, def);
    group.add(board);
    loader.registerPlaceholder(def.id, board);
    exploded.addPart(def.id, board, def.explodeOffset, def.explodeRotation || [0,0,0], def.explodeOrder);
  }

  _buildStem(group, loader, exploded, def) {
    // Tapered cylinder, slightly curved via lathe
    const points = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const r = 0.008 - t * 0.003; // tapers from 8mm to 5mm radius
      const y = t * 0.12;
      // Subtle S-curve
      const xOff = Math.sin(t * Math.PI) * 0.004;
      points.push(new THREE.Vector2(r + xOff, y));
    }
    const geo = new THREE.LatheGeometry(points, 16);
    const mat = _stdMat(def.material);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = def.id;
    mesh.castShadow = true;

    _place(mesh, def);
    group.add(mesh);
    loader.registerPlaceholder(def.id, mesh);
    exploded.addPart(def.id, mesh, def.explodeOffset, def.explodeRotation || [0,0,0], def.explodeOrder);
  }

  _buildPetal(index, group, loader, exploded, def) {
    const angle = (index / 6) * Math.PI * 2;
    const color = index < 3 ? 0xff6b35 : 0x7b5cfa;

    // Organic petal shape via ExtrudeGeometry
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo( 0.028,  0.02,  0.016, 0.08);
    shape.quadraticCurveTo( 0.018,  0.13,  0.008, 0.19);
    shape.quadraticCurveTo( 0.0,    0.22, -0.008, 0.19);
    shape.quadraticCurveTo(-0.018,  0.13, -0.016, 0.08);
    shape.quadraticCurveTo(-0.028,  0.02,  0.0,   0.0);

    const extrudeSettings = {
      depth: 0.008,
      bevelEnabled: true,
      bevelThickness: 0.003,
      bevelSize: 0.003,
      bevelSegments: 2,
      steps: 3,
    };

    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0,
      transparent: true,
      opacity: 0.84,
      side: THREE.DoubleSide,
    });

    const petalMesh = new THREE.Mesh(geo, mat);
    petalMesh.castShadow = true;

    // Centre on petal length axis
    geo.center();
    petalMesh.position.y = 0.10;

    // Tilt upward 25°
    petalMesh.rotation.x = -0.44;

    // Internal LED strip visible under silicone (thin emissive strip)
    const stripGeo = new THREE.BoxGeometry(0.004, 0.001, 0.17);
    const stripMat = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.6,
      roughness: 1,
      metalness: 0,
    });
    const strip = new THREE.Mesh(stripGeo, stripMat);
    strip.position.z = 0;
    petalMesh.add(strip);

    // Wrap petal in a group that holds the azimuth rotation
    const container = new THREE.Group();
    container.name = def.id;
    container.rotation.y = angle;
    container.add(petalMesh);

    _place(container, def);
    group.add(container);
    loader.registerPlaceholder(def.id, container);
    exploded.addPart(def.id, container, def.explodeOffset, def.explodeRotation || [0,0,0], def.explodeOrder);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function _stdMat(matDef) {
  if (!matDef) return new THREE.MeshStandardMaterial({ color: 0x888888 });
  const m = new THREE.MeshStandardMaterial({
    color:       matDef.color       || '#888888',
    roughness:   matDef.roughness   ?? 0.5,
    metalness:   matDef.metalness   ?? 0,
    transparent: matDef.transparent ?? false,
    opacity:     matDef.opacity     ?? 1,
    side:        matDef.transparent ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (matDef.emissive)          m.emissive.set(matDef.emissive);
  if (matDef.emissiveIntensity != null) m.emissiveIntensity = matDef.emissiveIntensity;
  return m;
}

function _place(object, def) {
  if (!def) return;
  const [px, py, pz] = def.assembledPosition || [0,0,0];
  const [rx, ry, rz] = def.assembledRotation || [0,0,0];
  object.position.set(px, py, pz);
  object.rotation.set(rx, ry, rz);
}
