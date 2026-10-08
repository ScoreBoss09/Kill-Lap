// Optional image textures: drop files into public/assets/textures/ (see the README there). Anything missing keeps the built-in procedural look.
const T = { images: {}, patterns: {}, loaded: false };
export default T;

/** world size (px) that one texture tile covers - a car is about 40px long */
const TILE = { ground: 512, road: 256, verge: 256, rock: 256, wall: 256, water: 192, roof: 140 };
const kind = name => name.split('_')[0];

T.load = async function () {
  let files = [];
  try { const r = await fetch('/api/textures'); if (r.ok) files = (await r.json()).files || []; else throw 0; } catch { try { const r = await fetch('assets/textures/manifest.json'); if (r.ok) files = await r.json(); } catch {} }
  await Promise.all(files.filter(f => /\.(png|jpe?g|webp)$/i.test(f)).map(f => new Promise(res => {
    const img = new Image(); img.onload = () => { this.images[f.replace(/\.[^.]+$/, '').toLowerCase()] = img; res(); }; img.onerror = res; img.src = 'assets/textures/' + encodeURIComponent(f);
  })));
  this.loaded = true; if (Object.keys(this.images).length) console.log('[textures]', Object.keys(this.images).join(', '));
};
/** pattern for e.g. get('ground', 'desert') -> tries ground_desert, then ground */
T.get = function (type, theme) {
  const key = (theme && this.images[type + '_' + theme]) ? type + '_' + theme : this.images[type] ? type : null; if (!key) return null;
  if (!this.patterns[key]) {
    const img = this.images[key], c = document.createElement('canvas'); c.width = 4; c.height = 4; const p = c.getContext('2d').createPattern(img, 'repeat');
    if (p && p.setTransform) p.setTransform(new DOMMatrix().scale((TILE[kind(key)] || 512) / img.width)); this.patterns[key] = p;
  }
  return this.patterns[key];
};

/** pattern anchored to the world (follows the camera) for dynamically drawn 3D surfaces; call once per frame per texture */
T.world = function (v, type, theme, sx = 0, sy = 0) {
  const key = (theme && this.images[type + '_' + theme]) ? type + '_' + theme : this.images[type] ? type : null; if (!key) return null;
  const img = this.images[key]; this.wp = this.wp || {};
  if (!this.wp[key]) { const c = document.createElement('canvas'); c.width = 4; c.height = 4; this.wp[key] = c.getContext('2d').createPattern(img, 'repeat'); }
  const p = this.wp[key]; this.wt = this.wt || {}; const st = v.t + ':' + v.x + ':' + v.zoom + ':' + sx + ':' + sy; if (this.wt[key] === st) return p; this.wt[key] = st;
  if (p && p.setTransform) p.setTransform(new DOMMatrix().translate(v.W / 2 - v.x * v.zoom + sx * v.zoom, v.H / 2 - v.y * v.zoom + sy * v.zoom).scale(v.zoom * (TILE[kind(key)] || 512) / img.width));
  return p;
};

/** like world(), but the texture is pre-tinted towards a colour (one fill instead of texture + tint pass) */
T.worldTinted = function (v, type, theme, col, alpha) {
  const key = (theme && this.images[type + '_' + theme]) ? type + '_' + theme : this.images[type] ? type : null; if (!key) return null;
  const k2 = key + '|' + col + '|' + alpha; this.tp = this.tp || {}; this.tpt = this.tpt || {};
  let p = this.tp[k2];
  if (!p) {
    const img = this.images[key], c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d');
    x.drawImage(img, 0, 0); x.globalAlpha = alpha; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height);
    p = this.tp[k2] = x.createPattern(c, 'repeat'); p._w = img.width;
  }
  const st = v.t + ':' + v.x + ':' + v.zoom; if (this.tpt[k2] !== st && p.setTransform) { this.tpt[k2] = st; p.setTransform(new DOMMatrix().translate(v.W / 2 - v.x * v.zoom, v.H / 2 - v.y * v.zoom).scale(v.zoom * (TILE[kind(key)] || 512) / p._w)); }
  return p;
};
