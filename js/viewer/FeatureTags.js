import * as THREE from 'three';

/**
 * FeatureTags
 * Manages HTML overlay labels anchored to 3D world positions.
 * Each tag projects its anchor point each frame from world→NDC→screen.
 */
export class FeatureTags {
  /**
   * @param {HTMLElement} container  - The #product-tags overlay div
   * @param {THREE.Camera} camera
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(container, camera, renderer) {
    this.container = container;
    this.camera = camera;
    this.renderer = renderer;

    /** @type {Map<string, { data: object, el: HTMLElement, anchorVec: THREE.Vector3 }>} */
    this.tags = new Map();
    this.activePhaseTags = new Set();

    this._ndcPos = new THREE.Vector3();
  }

  /** Build DOM elements for every tag in the assembly sequence (called once at load). */
  initFromSequence(phases) {
    phases.forEach(phase => {
      (phase.tags || []).forEach(tagData => {
        if (this.tags.has(tagData.id)) return; // already registered
        const el = this._createElement(tagData);
        this.container.appendChild(el);
        this.tags.set(tagData.id, {
          data: tagData,
          el,
          anchorVec: new THREE.Vector3(...tagData.anchorPosition)
        });
      });
    });
  }

  /** Show only the tags belonging to the given phase (by id array). */
  setPhase(tagIds) {
    const incoming = new Set(tagIds);

    this.tags.forEach(({ el }, id) => {
      const shouldShow = incoming.has(id);
      const isVisible = el.classList.contains('visible');
      if (shouldShow && !isVisible) el.classList.add('visible');
      if (!shouldShow && isVisible) el.classList.remove('visible');
    });

    this.activePhaseTags = incoming;
  }

  /** Called every frame — reprojects visible tag anchors to screen coords. */
  update() {
    if (this.activePhaseTags.size === 0) return;

    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;

    this.tags.forEach(({ el, anchorVec }) => {
      if (!el.classList.contains('visible')) return;

      // Project world position → NDC
      this._ndcPos.copy(anchorVec).project(this.camera);

      // Convert NDC [-1,1] to CSS pixels
      const x = (this._ndcPos.x * 0.5 + 0.5) * w;
      const y = (1 - (this._ndcPos.y * 0.5 + 0.5)) * h;

      // Hide if behind camera
      if (this._ndcPos.z > 1) {
        el.style.opacity = '0';
        return;
      }

      el.style.left = `${x}px`;
      el.style.top  = `${y}px`;
      el.style.opacity = '';
    });
  }

  resize() {
    // Positions recalculated each frame — nothing to do here
  }

  /** @private */
  _createElement(tagData) {
    const side = tagData.side || 'right';
    const el = document.createElement('div');
    el.className = `feature-tag side-${side}`;
    el.dataset.tagId = tagData.id;

    const dot  = document.createElement('div');
    dot.className = 'tag-dot';

    const line = document.createElement('div');
    line.className = 'tag-line';

    const pill = document.createElement('div');
    pill.className = 'tag-pill';

    const label = document.createElement('span');
    label.className = 'tag-label';
    label.textContent = tagData.label;

    pill.appendChild(label);

    if (tagData.detail) {
      const detail = document.createElement('span');
      detail.className = 'tag-detail';
      detail.textContent = tagData.detail;
      pill.appendChild(detail);
    }

    if (side === 'right') {
      el.appendChild(dot);
      el.appendChild(line);
      el.appendChild(pill);
    } else {
      el.appendChild(pill);
      el.appendChild(line);
      el.appendChild(dot);
    }

    return el;
  }
}
