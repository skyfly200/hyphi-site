import * as THREE from 'three';

/**
 * ScrollSequencer
 * Maps normalised scroll progress (0–1) from a tall scroll-driver element
 * to camera positions, explode factor, LED states, and tag visibility.
 *
 * Transitions between phases are eased — the camera lerps smoothly,
 * the explode factor animates, and content panels slide in/out.
 *
 * Usage:
 *   const seq = new ScrollSequencer(viewer, driverEl, phases);
 *   window.addEventListener('scroll', () => seq.onScroll());
 *   // In rAF loop:
 *   seq.update(time);
 */
export class ScrollSequencer {
  /**
   * @param {import('./ProductViewer.js').ProductViewer} viewer
   * @param {HTMLElement} driverEl   The tall scroll-driver div
   * @param {object[]}   phases      From assembly.json sequence array
   * @param {HTMLElement[]} panels   Content panels indexed by phase order
   * @param {HTMLElement[]} phaseDots Progress indicator dots
   */
  constructor(viewer, driverEl, phases, panels = [], phaseDots = []) {
    this.viewer    = viewer;
    this.driverEl  = driverEl;
    this.phases    = phases;
    this.panels    = panels;
    this.phaseDots = phaseDots;

    // Current smooth camera state (lerped each frame)
    this._camPos    = new THREE.Vector3();
    this._camTarget = new THREE.Vector3();
    this._fov       = 42;

    // Targets set by the active phase
    this._targetPos    = new THREE.Vector3();
    this._targetTarget = new THREE.Vector3();
    this._targetFov    = 42;

    // Explosion
    this._explodeFactor = 0;
    this._targetExplode = 0;

    // Product Y rotation
    this._productY = 0;
    this._targetProductY = 0;
    this._autoSpin = true;
    this._spinSpeed = 0.4;

    // Active phase tracking
    this._activePhaseId = null;
    this._scrollProgress = 0;

    // Lerp speeds (units per second for FOV, world units/s for pos)
    this._camLerpSpeed   = 3.5;
    this._fovLerpSpeed   = 2.5;
    this._rotLerpSpeed   = 2.0;
    this._explodeLerpSpeed = 2.2;

    // Bootstrap camera from first phase
    if (phases.length) {
      const first = phases[0];
      this._applyPhaseInstant(first);
    }

    this._scrollHint = document.querySelector('.scroll-hint');
  }

  /** Call from scroll event listener. */
  onScroll() {
    this._scrollProgress = this._computeProgress();
    this._updatePhase(this._scrollProgress);
  }

  /**
   * Call every animation frame.
   * @param {number} time  seconds since page load
   * @param {number} dt    delta time in seconds
   */
  update(time, dt = 0.016) {
    // Camera position lerp
    const lf = Math.min(1, this._camLerpSpeed * dt);
    this._camPos.lerp(this._targetPos, lf);
    this._camTarget.lerp(this._targetTarget, lf);
    this._fov += (this._targetFov - this._fov) * Math.min(1, this._fovLerpSpeed * dt);

    // Apply to Three.js camera
    const cam = this.viewer.camera;
    cam.position.copy(this._camPos);
    cam.lookAt(this._camTarget);
    if (Math.abs(cam.fov - this._fov) > 0.01) {
      cam.fov = this._fov;
      cam.updateProjectionMatrix();
    }

    // Explode factor lerp
    const ef = Math.min(1, this._explodeLerpSpeed * dt);
    this._explodeFactor += (this._targetExplode - this._explodeFactor) * ef;
    this.viewer.explodedView.setFactor(this._explodeFactor);

    // Product rotation
    if (this._autoSpin) {
      this._productY += this._spinSpeed * dt;
    } else {
      const rf = Math.min(1, this._rotLerpSpeed * dt);
      this._productY += (_angleDiff(this._targetProductY, this._productY)) * rf;
    }
    this.viewer.productGroup.rotation.y = this._productY;
  }

  /** @private */
  _computeProgress() {
    const rect = this.driverEl.getBoundingClientRect();
    const total = this.driverEl.offsetHeight - window.innerHeight;
    if (total <= 0) return 0;
    // scrollTop of driver relative to viewport top
    const scrolled = -rect.top;
    return Math.max(0, Math.min(1, scrolled / total));
  }

  /** @private */
  _updatePhase(progress) {
    // Find which phase we're in
    const phase = this._phaseAt(progress);
    if (!phase) return;

    if (this._scrollHint) {
      if (progress > 0.02) this._scrollHint.classList.add('hidden');
      else this._scrollHint.classList.remove('hidden');
    }

    // Only update targets when phase changes
    const phaseChanged = phase.id !== this._activePhaseId;
    if (phaseChanged) {
      this._activePhaseId = phase.id;
      this._applyPhaseTargets(phase);
      this._updateContentPanels(phase);
      this._updatePhaseDots(phase);
    }

    // LED state (update always — allows live LED animation)
    this.viewer.ledSystem.setState(phase.ledState || 'off');

    // Feature tags
    const tagIds = (phase.tags || []).map(t => t.id);
    this.viewer.featureTags.setPhase(tagIds);
  }

  /** @private — sets smooth targets from a phase definition */
  _applyPhaseTargets(phase) {
    const c = phase.camera;
    this._targetPos.set(...c.position);
    this._targetTarget.set(...c.target);
    this._targetFov = c.fov || 42;
    this._targetExplode = phase.explodeFactor ?? 0;

    const rot = phase.productRotation || {};
    this._autoSpin = rot.autoSpin || false;
    this._spinSpeed = rot.speed || 0.4;
    if (!this._autoSpin && rot.targetY !== undefined) {
      this._targetProductY = rot.targetY;
    }
  }

  /** @private — instant snap (used for bootstrap) */
  _applyPhaseInstant(phase) {
    const c = phase.camera;
    this._camPos.set(...c.position);
    this._camTarget.set(...c.target);
    this._targetPos.copy(this._camPos);
    this._targetTarget.copy(this._camTarget);
    this._fov = c.fov || 42;
    this._targetFov = this._fov;
    this._explodeFactor = phase.explodeFactor ?? 0;
    this._targetExplode = this._explodeFactor;

    const rot = phase.productRotation || {};
    this._autoSpin = rot.autoSpin !== false;
    this._spinSpeed = rot.speed || 0.4;
  }

  /** @private */
  _phaseAt(progress) {
    // Find first phase whose range contains progress
    for (const phase of this.phases) {
      if (progress >= phase.progressStart && progress <= phase.progressEnd) {
        return phase;
      }
    }
    // Clamp to last phase if past end
    return this.phases[this.phases.length - 1];
  }

  /** @private */
  _updateContentPanels(activePhase) {
    this.panels.forEach(panel => {
      const pid = panel.dataset.phase;
      if (pid === activePhase.id) {
        panel.classList.add('active');
        // Vertical position: centre panel in the viewport during its phase
        const phaseCenter = (activePhase.progressStart + activePhase.progressEnd) / 2;
        const driverH = this.driverEl.offsetHeight;
        const panelY = phaseCenter * (driverH - window.innerHeight) + window.innerHeight * 0.5 - 120;
        panel.style.top = `${panelY}px`;
      } else {
        panel.classList.remove('active');
      }
    });
  }

  /** @private */
  _updatePhaseDots(activePhase) {
    const activeIdx = this.phases.findIndex(p => p.id === activePhase.id);
    this.phaseDots.forEach((dot, i) => {
      dot.classList.toggle('active', i === activeIdx);
    });
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Shortest signed angle difference (radians). */
function _angleDiff(target, current) {
  let diff = target - current;
  while (diff >  Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}
