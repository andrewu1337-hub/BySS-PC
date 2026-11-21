'use strict';
// Значки сайтов на чёрной плитке — так же, как на телефоне: белый фон значка убираем,
// цветной фон (красный у Яндекса) делаем чёрным, а белую букву — цвета этого фона.
(function (root) {
  function lum(r, g, b) { return (r * 299 + g * 587 + b * 114) / 1000; }
  function sat(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx <= 0 ? 0 : (mx - mn) / mx;
  }
  function median(a, m) {
    const s = Array.from(a.subarray(0, m)).sort((x, y) => x - y);
    return s[m >> 1];
  }

  function blackTile(img) {
    const w = img.width, h = img.height, n = w * h, d = img.data;
    const clear = new Uint8Array(n);
    for (let i = 0; i < n; i++) clear[i] = d[i * 4 + 3] < 128 ? 1 : 0;
    const idx = [];
    for (let x = 0; x < w; x++) idx.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) idx.push(y * w, y * w + w - 1);

    // 1) прозрачное поле вокруг рисунка
    const region = new Uint8Array(n);
    const q = new Int32Array(n);
    let head = 0, tail = 0, clearEdge = 0;
    for (const j of idx) {
      if (clear[j]) {
        clearEdge++;
        if (!region[j]) { region[j] = 1; q[tail++] = j; }
      }
    }
    while (head < tail) {
      const i = q[head++], x = i % w, y = (i / w) | 0;
      if (x > 0 && clear[i - 1] && !region[i - 1]) { region[i - 1] = 1; q[tail++] = i - 1; }
      if (x < w - 1 && clear[i + 1] && !region[i + 1]) { region[i + 1] = 1; q[tail++] = i + 1; }
      if (y > 0 && clear[i - w] && !region[i - w]) { region[i - w] = 1; q[tail++] = i - w; }
      if (y < h - 1 && clear[i + w] && !region[i + w]) { region[i + w] = 1; q[tail++] = i + w; }
    }
    const outside = tail > 0;

    // 2) цвет фона: края или «подложка» (белый круг на прозрачном)
    const rr = new Int32Array(n), gg = new Int32Array(n), bb = new Int32Array(n);
    let m = 0;
    const add = (i) => { rr[m] = d[i * 4]; gg[m] = d[i * 4 + 1]; bb[m] = d[i * 4 + 2]; m++; };
    if (outside) {
      for (let i = 0; i < n; i++) {
        if (clear[i]) continue;
        const x = i % w, y = (i / w) | 0;
        if ((x > 0 && region[i - 1]) || (x < w - 1 && region[i + 1]) || (y > 0 && region[i - w]) || (y < h - 1 && region[i + w])) add(i);
      }
    } else {
      for (const j of idx) add(j);
    }
    let mode, bgR = 0, bgG = 0, bgB = 0;
    if (m === 0) {
      mode = 'T';
    } else {
      bgR = median(rr, m); bgG = median(gg, m); bgB = median(bb, m);
      const L = lum(bgR, bgG, bgB), S = sat(bgR, bgG, bgB);
      if (S < 0.18 && L > 170) mode = 'L';
      else if (L < 50) mode = 'D';
      else if (clearEdge > idx.length * 0.4) mode = 'T';
      else mode = 'C';
    }
    const T = mode === 'L' ? 88 : 64, D0 = mode === 'L' ? 18 : 14;
    const dist = new Float32Array(n);
    if (mode !== 'T') {
      for (let i = 0; i < n; i++) {
        const dr = d[i * 4] - bgR, dg = d[i * 4 + 1] - bgG, db = d[i * 4 + 2] - bgB;
        dist[i] = Math.sqrt(dr * dr + dg * dg + db * db);
      }
      if (mode === 'C') {
        for (let i = 0; i < n; i++) if (dist[i] < T) region[i] = 1;
      } else {
        head = 0; tail = 0;
        for (let i = 0; i < n; i++) if (region[i]) q[tail++] = i;
        for (const j of idx) if (!region[j] && dist[j] < T) { region[j] = 1; q[tail++] = j; }
        const grow = (j) => {
          if (!region[j] && (clear[j] || dist[j] < T)) { region[j] = 1; q[tail++] = j; }
        };
        while (head < tail) {
          const i = q[head++], x = i % w, y = (i / w) | 0;
          if (x > 0) grow(i - 1);
          if (x < w - 1) grow(i + 1);
          if (y > 0) grow(i - w);
          if (y < h - 1) grow(i + w);
        }
      }
    }

    // 3) убрать фон, мягко по краям
    const f = new Float32Array(n * 4);
    let lightAch = 0;
    for (let i = 0; i < n; i++) {
      let r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], a = d[i * 4 + 3];
      if (mode !== 'T' && region[i] && dist[i] < T) {
        const k = Math.max(0, Math.min(1, (dist[i] - D0) / (T - D0)));
        if (k < 0.02) { f[i * 4 + 3] = 0; continue; }
        r = Math.max(0, Math.min(255, (r - (1 - k) * bgR) / k));
        g = Math.max(0, Math.min(255, (g - (1 - k) * bgG) / k));
        b = Math.max(0, Math.min(255, (b - (1 - k) * bgB) / k));
        a *= k;
      }
      f[i * 4] = r; f[i * 4 + 1] = g; f[i * 4 + 2] = b; f[i * 4 + 3] = a;
      if (mode === 'C' && a > 20 && sat(r, g, b) < 0.25 && lum(r, g, b) >= 110) lightAch++;
    }
    const hasLight = lightAch > n / 100;

    // 4) перекрасить, чтобы на чёрном было видно
    const out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      const a = f[i * 4 + 3];
      if (a <= 0) continue;
      let r = f[i * 4], g = f[i * 4 + 1], b = f[i * 4 + 2];
      const l = lum(r, g, b), s = sat(r, g, b);
      if (mode === 'C') {
        if (a > 20 && s < 0.25) {
          if (l >= 110 || !hasLight) { r = bgR; g = bgG; b = bgB; } else { r = g = b = 255; }
        }
      } else if (Math.max(r, g, b) < 120) {
        r = g = b = 245; // тёмный рисунок → белый
      }
      out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a;
    }
    return { width: w, height: h, data: out, mode };
  }

  root.blackTile = blackTile;
  if (typeof module !== 'undefined') module.exports = { blackTile };
})(typeof window !== 'undefined' ? window : globalThis);
