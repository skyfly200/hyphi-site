/* Product page gallery + 3D explorer hook.
 *
 * Photos: each <li data-src="images/02.jpg" data-label="Lit at night"> in .thumbs
 * is one photo slot. Drop a file at that path and it shows up; until then the
 * slot renders as a dashed placeholder naming the file it expects.
 *
 * 3D: set data-model="models/<name>.glb" on .media and a "3D" toggle appears.
 * <model-viewer> is only loaded from the CDN the first time someone opens it.
 */
(() => {
  const MODEL_VIEWER_SRC = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js';

  const media = document.querySelector('.media');
  if (!media) return;
  const stage = media.querySelector('.stage');
  const items = [...media.querySelectorAll('.thumbs li')];
  const title = document.querySelector('.info h1')?.textContent.trim() || 'Product';

  function slot(label, src) {
    const el = document.createElement('div');
    el.className = 'slot';
    el.innerHTML = `<span></span><code></code>`;
    el.firstChild.textContent = label ? `Photo slot: ${label}` : 'Photo slot';
    el.lastChild.textContent = src;
    return el;
  }

  // Render an image, or a placeholder slot if the file is missing.
  function picture(src, label, eager) {
    const img = new Image();
    img.alt = label ? `${title}: ${label}` : title;
    img.decoding = 'async';
    if (!eager) img.loading = 'lazy';
    const wrap = document.createDocumentFragment();
    wrap.append(img);
    img.addEventListener('error', () => img.replaceWith(slot(label, src)), { once: true });
    img.src = src;
    return wrap;
  }

  let current = 0;

  function show(i) {
    current = i;
    const { src, label } = items[i].dataset;
    stage.querySelectorAll('img, .slot, model-viewer').forEach(el => el.remove());
    stage.prepend(picture(src, label, true));
    items.forEach((li, j) => li.querySelector('button').setAttribute('aria-current', String(j === i)));
    setMode('photo');
  }

  items.forEach((li, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', li.dataset.label || `Photo ${i + 1}`);
    btn.append(picture(li.dataset.src, li.dataset.label, false));
    btn.addEventListener('click', () => show(i));
    li.append(btn);
  });

  /* ── 3D explorer ── */
  const model = media.dataset.model;
  let toggle, viewerLoaded;

  function loadViewer() {
    viewerLoaded ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.type = 'module';
      s.src = MODEL_VIEWER_SRC;
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
    return viewerLoaded;
  }

  function setMode(mode) {
    if (!toggle) return;
    toggle.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  }

  async function show3d() {
    setMode('3d');
    await loadViewer();
    stage.querySelectorAll('img, .slot').forEach(el => el.remove());
    if (stage.querySelector('model-viewer')) return;
    const mv = document.createElement('model-viewer');
    mv.setAttribute('src', model);
    mv.setAttribute('alt', `3D model of ${title}`);
    mv.setAttribute('camera-controls', '');
    mv.setAttribute('auto-rotate', '');
    mv.setAttribute('shadow-intensity', '1');
    if (media.dataset.poster) mv.setAttribute('poster', media.dataset.poster);
    stage.prepend(mv);
  }

  if (model) {
    toggle = document.createElement('div');
    toggle.className = 'stage-mode';
    toggle.innerHTML = '<button type="button" data-mode="photo">Photos</button><button type="button" data-mode="3d">3D</button>';
    toggle.addEventListener('click', e => {
      const mode = e.target.dataset?.mode;
      if (mode === '3d') show3d();
      else if (mode === 'photo') show(current);
    });
    stage.append(toggle);
  }

  if (items.length) show(0);
})();

/* Sign-up modal.
 *
 * Any [data-signup="<product>"] link opens a Mailchimp sign-up dialog. The
 * product is sent as the PRODUCT merge field, so the audience needs a text
 * field with that merge tag (Audience → Settings → Audience fields). Without
 * JS the link falls back to the homepage sign-up form.
 */
(() => {
  const MC_ACTION = 'https://art.us6.list-manage.com/subscribe/post?u=ac305ca222d2841ab524e6ea3&id=4baeb2e2b3&f_id=00d41de2f0';
  const MC_HONEYPOT = 'b_ac305ca222d2841ab524e6ea3_4baeb2e2b3';

  const triggers = document.querySelectorAll('[data-signup]');
  if (!triggers.length) return;

  const dialog = document.createElement('dialog');
  dialog.className = 'signup-modal';
  dialog.setAttribute('aria-labelledby', 'signup-modal-title');
  dialog.innerHTML = `<div class="signup-inner">
    <button type="button" class="signup-close" aria-label="Close">×</button>
    <p class="signup-eyebrow">Be early</p>
    <h2 id="signup-modal-title">Get <strong></strong> updates</h2>
    <p class="signup-copy">News on this product, plus new releases and deals. No spam.</p>
    <form method="post" target="_blank" novalidate>
      <input type="hidden" name="PRODUCT">
      <div style="position:absolute;left:-5000px" aria-hidden="true">
        <input type="text" name="${MC_HONEYPOT}" tabindex="-1" value="">
      </div>
      <div class="signup-field">
        <input type="email" name="EMAIL" placeholder="your@email.com" autocomplete="email" required aria-label="Email">
        <button type="submit">Notify me</button>
      </div>
    </form></div>`;
  document.body.append(dialog);

  const form = dialog.querySelector('form');
  form.action = MC_ACTION;
  const productField = form.elements.PRODUCT;
  const email = form.elements.EMAIL;
  const copy = dialog.querySelector('.signup-copy');
  const defaultCopy = copy.textContent;

  triggers.forEach(el => el.addEventListener('click', e => {
    e.preventDefault();
    productField.value = el.dataset.signup;
    copy.textContent = defaultCopy;
    dialog.querySelector('h2 strong').textContent =
      el.dataset.signupName || document.querySelector('.info h1')?.textContent.trim() || 'Hyphi';
    dialog.showModal();
    email.focus();
  }));

  dialog.querySelector('.signup-close').addEventListener('click', () => dialog.close());
  // Click on the backdrop closes it.
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

  form.addEventListener('submit', e => {
    if (!email.checkValidity()) { e.preventDefault(); email.reportValidity(); return; }
    // Mailchimp opens in a new tab; leave a thank-you here.
    setTimeout(() => {
      form.reset();
      copy.textContent = 'Thanks! Check the new tab to confirm your subscription.';
    }, 0);
  });
})();
