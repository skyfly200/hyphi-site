import * as THREE from 'three';
import { FeatureTags }       from './FeatureTags.js';
import { ExplodedView }      from './ExplodedView.js';
import { LEDSystem }         from './LEDSystem.js';
import { AssetLoader }       from './AssetLoader.js';
import { PlaceholderProduct } from './PlaceholderProduct.js';
import { ScrollSequencer }   from './ScrollSequencer.js';

/**
 * ProductViewer
 * Top-level orchestrator for the 3D product viewer experience.
 *
 * Initialise with:
 *   const viewer = new ProductViewer(canvasContainer, tagsContainer);
 *   viewer.load('/data/glow-flora/assembly.json', '/data/glow-flora/leds.json');
 *
 * Public API:
 *   viewer.swapModel(partId, glbUrl)         – live model swap
 *   viewer.swapTexture(partId, texUrl, map)  – live texture swap
 *   viewer.dispose()                         – clean up all resources
 */
export class ProductViewer {
  /**
   * @param {HTMLElement} canvasContainer   #product-canvas
   * @param {HTMLElement} tagsContainer     #product-tags
   * @param {HTMLElement} scrollDriver      .scroll-driver
   * @param {HTMLElement[]} contentPanels   .scroll-content-panel elements
   * @param {HTMLElement[]} phaseDots       .phase-dot elements
   */
  constructor(canvasContainer, tagsContainer, scrollDriver, contentPanels = [], phaseDots = []) {
    this.canvasContainer = canvasContainer;
    this.tagsContainer   = tagsContainer;
    this.scrollDriver    = scrollDriver;
    this.contentPanels   = contentPanels;
    this.phaseDots       = phaseDots;

    this._lastTime = 0;
    this._rafId    = null;
    this._ready    = false;

    this._setupRenderer();
    this._setupScene();
    this._setupCamera();
    this._setupLights();
    this._setupSystems();
    this._bindEvents();
    this._animate(0);
  }

  // ── public API ──────────────────────────────────────────────────────────────

  /**
   * Load a product from assembly + LED JSON files.
   * @param {string} assemblyUrl
   * @param {string} ledDataUrl
   */
  async load(assemblyUrl, ledDataUrl) {
    const loadingEl = this.canvasContainer.closest('.viewer-stage')?.querySelector('.viewer-loading');

    try {
      const [assemblyData, ledData] = await Promise.all([
        fetch(assemblyUrl).then(r => r.json()),
        fetch(ledDataUrl).then(r => r.json()),
      ]);

      // Build placeholder geometry first (instant, no network)
      const placeholder = new PlaceholderProduct();
      placeholder.build(this.productGroup, this.assetLoader, this.explodedView, assemblyData);

      // Initialise LED system
      this.ledSystem.init(ledData);

      // Register tags from all phases
      this.featureTags.initFromSequence(assemblyData.sequence);

      // Set up scroll sequencer with phase data
      this.scrollSequencer = new ScrollSequencer(
        this,
        this.scrollDriver,
        assemblyData.sequence,
        this.contentPanels,
        this.phaseDots
      );

      // Optionally load real GLBs if model paths are present
      this.assetLoader.load(assemblyData, () => {
        // Re-register exploded view after real models load
        assemblyData.parts.forEach(partDef => {
          const obj = this.assetLoader.getPart(partDef.id);
          if (obj && this.explodedView.parts.has(partDef.id)) {
            // Real model loaded — update exploded view reference
            this.explodedView.parts.get(partDef.id).object = obj;
          }
        });
      });

      this._ready = true;
      if (loadingEl) {
        setTimeout(() => loadingEl.classList.add('hidden'), 400);
      }

      // Bootstrap scroll state
      this.scrollSequencer.onScroll();

    } catch (err) {
      console.error('[ProductViewer] load failed:', err);
    }
  }

  /** Replace a part's GLB model at runtime. */
  swapModel(partId, glbUrl) {
    const partDef = this._assemblyData?.parts?.find(p => p.id === partId);
    this.assetLoader.swapModel(partId, glbUrl, partDef);
  }

  /** Replace a texture map on a part at runtime. */
  swapTexture(partId, textureUrl, mapType = 'map') {
    this.assetLoader.swapTexture(partId, textureUrl, mapType);
  }

  dispose() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    window.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
    this.ledSystem.clear();
    this.explodedView.clear();
  }

  // ── setup ────────────────────────────────────────────────────────────────────

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha:     false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.canvasContainer.offsetWidth, this.canvasContainer.offsetHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type   = THREE.PCFSoftShadowMap;
    this.canvasContainer.appendChild(this.renderer.domElement);
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a0f);

    // Subtle radial fog to frame the product
    this.scene.fog = new THREE.FogExp2(0x0a0a0f, 1.8);

    // Floor shadow catcher (invisible, receives shadows only)
    const floorGeo = new THREE.PlaneGeometry(2, 2);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.position.y = -0.001;
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);

    // Product root group
    this.productGroup = new THREE.Group();
    this.productGroup.name = 'product';
    this.scene.add(this.productGroup);
  }

  _setupCamera() {
    const w = this.canvasContainer.offsetWidth;
    const h = this.canvasContainer.offsetHeight;
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.001, 20);
    this.camera.position.set(0, 0.28, 0.9);
    this.camera.lookAt(0, 0.18, 0);
  }

  _setupLights() {
    // Ambient — just enough fill so shadows aren't pitch black
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    // Key light — warm top-front
    const key = new THREE.DirectionalLight(0xfff5e8, 2.2);
    key.position.set(1.5, 3, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far  = 8;
    key.shadow.camera.left = key.shadow.camera.bottom = -0.6;
    key.shadow.camera.right = key.shadow.camera.top   =  0.6;
    key.shadow.bias = -0.001;
    this.scene.add(key);

    // Fill light — cool left
    const fill = new THREE.DirectionalLight(0xd0d8ff, 0.55);
    fill.position.set(-2, 1.5, -1);
    this.scene.add(fill);

    // Rim / back light — accent purple, lifts edges
    const rim = new THREE.DirectionalLight(0x7b5cfa, 1.1);
    rim.position.set(-0.5, -1, -2);
    this.scene.add(rim);

    // Under-light — orange glow from below like a light table
    const under = new THREE.PointLight(0xff6b35, 0.6, 0.8);
    under.position.set(0, -0.08, 0.1);
    this.scene.add(under);

    /*
     * PRE-BAKED LIGHTING NOTES:
     * When real GLB models are available, bake ambient occlusion + indirect
     * bounce into a lightmap texture (UV2 channel) and load it here via:
     *
     *   const lmLoader = new THREE.TextureLoader();
     *   const lightmap = lmLoader.load('/data/glow-flora/textures/lightmap.webp');
     *   lightmap.colorSpace = THREE.LinearSRGBColorSpace;
     *   mesh.material.lightMap = lightmap;
     *   mesh.material.lightMapIntensity = 1.5;
     *
     * This eliminates real-time shadow cost and produces physically accurate AO.
     * The pre-bake pipeline: Blender → Cycles bake (AO + diffuse) → export UV2
     * → WebP compress → load above.
     */
  }

  _setupSystems() {
    this.featureTags  = new FeatureTags(this.tagsContainer, this.camera, this.renderer);
    this.explodedView = new ExplodedView();
    this.ledSystem    = new LEDSystem(this.scene);
    this.assetLoader  = new AssetLoader(this.scene, this.productGroup);
    // ScrollSequencer is created in load() once we have phase data
    this.scrollSequencer = null;
  }

  // ── event binding ─────────────────────────────────────────────────────────────

  _bindEvents() {
    this._onScroll = () => { if (this.scrollSequencer) this.scrollSequencer.onScroll(); };
    this._onResize = () => this._resize();

    window.addEventListener('scroll',  this._onScroll, { passive: true });
    window.addEventListener('resize',  this._onResize, { passive: true });
  }

  _resize() {
    const w = this.canvasContainer.offsetWidth;
    const h = this.canvasContainer.offsetHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.featureTags.resize();
  }

  // ── render loop ───────────────────────────────────────────────────────────────

  _animate(now) {
    this._rafId = requestAnimationFrame(t => this._animate(t));

    const time = now * 0.001;
    const dt   = Math.min(0.05, time - this._lastTime); // cap dt at 50ms
    this._lastTime = time;

    if (this.scrollSequencer) {
      this.scrollSequencer.update(time, dt);
    } else {
      // Idle spin before data loads
      this.productGroup.rotation.y += 0.004;
    }

    this.ledSystem.update(time);
    this.featureTags.update();

    this.renderer.render(this.scene, this.camera);
  }
}
