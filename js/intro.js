/* Intro animada del L-3: el engranaje sube, el matraz se llena, la herramienta lo atraviesa y aparece
   el nombre. Se muestra una vez por visita; clic, toque o Esc la saltan. */
(function () {
  const SPEED = 1; // 1 = 5 s (más bajo = más rápido)
  const intro = document.getElementById('mice-intro');
  if (!intro) return;
  // Una vez por visita (sessionStorage) y nunca con "reducir movimiento".
  let yaVista = false;
  try { yaVista = sessionStorage.getItem('mice-intro-vista') === '1'; } catch {}
  if (yaVista || matchMedia('(prefers-reduced-motion: reduce)').matches) { intro.remove(); return; }
  try { sessionStorage.setItem('mice-intro-vista', '1'); } catch {}
  document.documentElement.classList.add('intro-activa'); // la página de atrás no se desplaza

  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = intro.querySelector('svg');
  // Pantalla vertical (celular): encuadre más cerrado y centrado en el logo.
  const fit = () => svgEl.setAttribute('viewBox', innerWidth / innerHeight < 0.9 ? '190 -120 620 840' : '0 0 1000 600');
  fit();
  addEventListener('resize', fit);

  // ---- letras en trazos (tipografía Poppins): "MICE L3" y "FES ARAGÓN" ----
  // dx: corrimiento de cada letra; sin el guion de "L-3", el 3 queda junto a la L y la palabra sigue centrada.
  const LET = {
    l1: [
      { x: 52.17, dx: 9.4, d: `
        M64.11 216.94 V238 H58.98 V225.37 L54.27 238 H50.13 L45.39 225.34 V238 H40.26 V216.94 H46.32
        L52.23 231.52 L58.08 216.94 Z` },
      { x: 72.86, dx: 9.4, d: "M75.43 216.94V238H70.3V216.94Z" },
      { x: 91.22, dx: 9.4, d: `
        M91.37 216.7 Q95.12 216.7 97.79 218.68 Q100.46 220.66 101.36 224.08 H95.72 Q95.09 222.76 93.935
        222.07 Q92.78 221.38 91.31 221.38 Q88.94 221.38 87.47 223.03 Q86 224.68 86 227.44 Q86 230.2
        87.47 231.85 Q88.94 233.5 91.31 233.5 Q92.78 233.5 93.935 232.81 Q95.09 232.12 95.72 230.8
        H101.36 Q100.46 234.22 97.79 236.185 Q95.12 238.15 91.37 238.15 Q88.31 238.15 85.895 236.785
        Q83.48 235.42 82.13 232.99 Q80.78 230.56 80.78 227.44 Q80.78 224.32 82.13 221.875 Q83.48 219.43
        85.895 218.065 Q88.31 216.7 91.37 216.7 Z` },
      { x: 113.26, dx: 9.4, d: `
        M112.14 221.05 V225.31 H119.01 V229.27 H112.14 V233.89 H119.91 V238 H107.01 V216.94 H119.91
        V221.05 Z` },
      { x: 139.9, dx: 9.4, d: "M139.73 234.04H146.45V238H134.6V216.94H139.73Z" },
      { x: 178.52, dx: -9.36, d: `
        M178.45 215.59 Q180.7 215.59 182.305 216.37 Q183.91 217.15 184.735 218.5 Q185.56 219.85 185.56
        221.53 Q185.56 223.51 184.57 224.755 Q183.58 226 182.26 226.45 V226.57 Q183.97 227.14 184.96
        228.46 Q185.95 229.78 185.95 231.85 Q185.95 233.71 185.095 235.135 Q184.24 236.56 182.605 237.37
        Q180.97 238.18 178.72 238.18 Q175.12 238.18 172.975 236.41 Q170.83 234.64 170.71 231.07 H175.69
        Q175.72 232.39 176.44 233.155 Q177.16 233.92 178.54 233.92 Q179.71 233.92 180.355 233.245 Q181
        232.57 181 231.46 Q181 230.02 180.085 229.375 Q179.17 228.73 177.16 228.73 H176.2 V224.56
        H177.16 Q178.69 224.56 179.635 224.035 Q180.58 223.51 180.58 222.16 Q180.58 221.08 179.98 220.48
        Q179.38 219.88 178.33 219.88 Q177.19 219.88 176.635 220.57 Q176.08 221.26 175.99 222.28 H170.98
        Q171.1 219.07 173.08 217.33 Q175.06 215.59 178.45 215.59 Z` }
    ],
    l2: [
      { x: 57.33, d: `
        M60.617 251.923 V253.271 H56.34 V256.243 H59.675 V257.592 H56.34 V262 H54.687 V251.923 Z` },
      { x: 68.07, d: `
        M67.007 253.256 V256.214 H70.487 V257.563 H67.007 V260.651 H70.922 V262 H65.354 V251.908 H70.922
        V253.256 Z` },
      { x: 79.44, d: `
        M75.906 259.216 H77.675 Q77.733 259.868 78.19 260.289 Q78.646 260.709 79.473 260.709 Q80.328
        260.709 80.807 260.296 Q81.285 259.883 81.285 259.231 Q81.285 258.723 80.988 258.404 Q80.691
        258.085 80.249 257.911 Q79.806 257.737 79.023 257.534 Q78.037 257.273 77.421 257.005 Q76.805
        256.736 76.37 256.171 Q75.935 255.606 75.935 254.663 Q75.935 253.793 76.37 253.141 Q76.805
        252.488 77.588 252.14 Q78.371 251.792 79.4 251.792 Q80.865 251.792 81.8 252.524 Q82.735 253.256
        82.837 254.532 H81.01 Q80.966 253.982 80.488 253.59 Q80.009 253.198 79.226 253.198 Q78.516
        253.198 78.066 253.561 Q77.617 253.923 77.617 254.605 Q77.617 255.069 77.9 255.366 Q78.182
        255.663 78.617 255.838 Q79.052 256.012 79.806 256.214 Q80.807 256.49 81.438 256.765 Q82.068
        257.041 82.511 257.614 Q82.953 258.187 82.953 259.144 Q82.953 259.912 82.54 260.593 Q82.126
        261.275 81.336 261.688 Q80.546 262.101 79.473 262.101 Q78.458 262.101 77.646 261.746 Q76.834
        261.391 76.37 260.739 Q75.906 260.086 75.906 259.216 Z` },
      { x: 99.05, d: `
        M101.156 259.941 H96.936 L96.211 262 H94.486 L98.096 251.908 H100.01 L103.621 262 H101.881 Z
        M100.692 258.592 99.053 253.909 97.4 258.592 Z` },
      { x: 111.88, d: `
        M113.621 262 111.301 257.969 H110.04 V262 H108.387 V251.923 H111.867 Q113.027 251.923 113.832
        252.329 Q114.636 252.734 115.035 253.416 Q115.434 254.097 115.434 254.939 Q115.434 255.924
        114.861 256.729 Q114.288 257.534 113.099 257.824 L115.593 262 Z M110.04 256.649 H111.867
        Q112.795 256.649 113.266 256.185 Q113.737 255.721 113.737 254.939 Q113.737 254.155 113.273
        253.713 Q112.809 253.271 111.867 253.271 H110.04 Z` },
      { x: 124.72, d: `
        M126.826 259.941 H122.607 L121.882 262 H120.156 L123.767 251.908 H125.681 L129.291 262 H127.551
        Z M126.362 258.592 124.724 253.909 123.071 258.592 Z` },
      { x: 138.57, d: `
        M141.351 254.822 Q140.959 254.069 140.263 253.684 Q139.567 253.3 138.654 253.3 Q137.653 253.3
        136.87 253.75 Q136.087 254.199 135.645 255.026 Q135.203 255.852 135.203 256.94 Q135.203 258.027
        135.645 258.861 Q136.087 259.695 136.87 260.144 Q137.653 260.594 138.654 260.594 Q140.002
        260.594 140.843 259.84 Q141.684 259.086 141.873 257.795 H138.088 V256.476 H143.642 V257.766
        Q143.482 258.94 142.808 259.927 Q142.134 260.913 141.053 261.5 Q139.973 262.087 138.654 262.087
        Q137.233 262.087 136.058 261.427 Q134.884 260.767 134.195 259.593 Q133.506 258.418 133.506
        256.94 Q133.506 255.46 134.195 254.286 Q134.884 253.112 136.065 252.452 Q137.247 251.792 138.654
        251.792 Q140.263 251.792 141.517 252.582 Q142.772 253.373 143.337 254.822 Z` },
      { x: 153.06, d: `
        M147.915 256.94 Q147.915 255.46 148.603 254.286 Q149.292 253.112 150.474 252.452 Q151.656
        251.792 153.062 251.792 Q154.483 251.792 155.665 252.452 Q156.847 253.112 157.528 254.286
        Q158.21 255.46 158.21 256.94 Q158.21 258.418 157.528 259.6 Q156.847 260.782 155.665 261.442
        Q154.483 262.101 153.062 262.101 Q151.656 262.101 150.474 261.442 Q149.292 260.782 148.603 259.6
        Q147.915 258.418 147.915 256.94 Z M156.513 256.94 Q156.513 255.823 156.071 254.982 Q155.629
        254.141 154.846 253.691 Q154.063 253.242 153.062 253.242 Q152.062 253.242 151.279 253.691
        Q150.496 254.141 150.054 254.982 Q149.611 255.823 149.611 256.94 Q149.611 258.056 150.054
        258.904 Q150.496 259.752 151.279 260.209 Q152.062 260.666 153.062 260.666 Q154.063 260.666
        154.846 260.209 Q155.629 259.752 156.071 258.904 Q156.513 258.056 156.513 256.94 Z M154.556
        249.762 151.351 251.342 V250.124 L154.556 248.355 Z` },
      { x: 167.17, d: `
        M171.313 262 H169.66 L164.687 254.475 V262 H163.034 V251.908 H164.687 L169.66 259.419 V251.908
        H171.313 Z` }
    ],
  };
  const crearLetras = (lista, padre, base) => lista.map((G, i) => {
    const g = document.createElementNS(NS, 'g');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', G.d);
    p.setAttribute('class', 'w');
    p.setAttribute('transform', `translate(${-G.x} ${-base})`);
    g.appendChild(p);
    $(padre).appendChild(g);
    return { g, x: G.x + (G.dx || 0), i, base };
  });
  const L1 = crearLetras(LET.l1, 'l3-text1', 238);
  const L2 = crearLetras(LET.l2, 'l3-text2', 262);

  // ---- curvas de suavizado ----
  const E = {
    lin: (t) => t,
    io: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    out: (t) => Math.sin((t * Math.PI) / 2),
    in: (t) => 1 - Math.cos((t * Math.PI) / 2),
    out3: (t) => 1 - Math.pow(1 - t, 3),
    in3: (t) => t * t * t,
    back: (t) => { const c = 1.5; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    inBack: (t) => { const c = 1.5; return (c + 1) * t * t * t - c * t * t; },
  };
  const K = (claves) => (ms) => {
    if (ms <= claves[0][0]) return claves[0][1];
    for (let i = 1; i < claves.length; i++) {
      const [t1, v1, e] = claves[i], [t0, v0] = claves[i - 1];
      if (ms <= t1) return v0 + (v1 - v0) * E[e || 'io']((ms - t0) / (t1 - t0));
    }
    return claves[claves.length - 1][1];
  };

  const GC = [120.4, 116.7]; // centro del engranaje
  const U = [0.7073358506222847, 0.7068776375190043]; // dirección de la herramienta

  // ================= LÍNEA DE TIEMPO (ms) =================
  const T = {
    // 1. el engranaje sube girando desde abajo
    gy: K([[0, 460], [820, -10, 'out3'], [1000, 0, 'io'], [1180, 0], [1230, 2.5, 'out'], [1400, 0, 'io']]),
    gr: K([[0, -200], [820, 6, 'out3'], [1050, 0, 'io'], [2450, 0], [2500, 4, 'out'], [2650, -2, 'io'], [2800, 0, 'io']]),
    gsx: K([[820, 1], [900, 1.05, 'out'], [1050, 1, 'io']]),
    gsy: K([[820, 1], [900, 0.95, 'out'], [1050, 1, 'io']]),
    // 2. cae el líquido y llena el matraz
    sHead: K([[950, -80], [1180, 150, 'in3']]),
    sTail: K([[1620, -80], [1880, 150, 'in3']]),
    lvl: K([[1180, 154], [1950, 112.5, 'out']]),
    wave: K([[1180, 0], [1350, 3.2, 'out'], [1950, 2.2], [2350, 0, 'io']]),
    // 3. la herramienta lo atraviesa
    td: K([[2050, -330], [2430, 4, 'out3'], [2560, 0, 'io']]),
    // 4. letras, crecer y salida
    ls: K([[3150, 1], [3550, 1.06, 'back']]),
    lsx: K([[4150, 1], [4250, 1.05, 'out'], [4520, 0.92, 'in3']]),
    lsy: K([[4150, 1], [4250, 0.93, 'out'], [4520, 1.3, 'in3']]),
    ly: K([[4150, 0], [4250, 8, 'out'], [4520, -400, 'in3']]),
    cur: K([[4500, 160], [5000, 0, 'io']]),
  };
  const END = 5000;
  const set = (id, v) => $(id).setAttribute('transform', v);

  // Tiempo propio de la animación: si el navegador se traba un momento, avanza máximo 40 ms por cuadro
  // (sigue donde iba en lugar de brincar hacia adelante).
  let anterior = null, transcurrido = 0, raf, paused = false;
  function frame(now) {
    if (anterior === null) anterior = now;
    transcurrido += Math.min(now - anterior, 40);
    anterior = now;
    const ms = transcurrido / SPEED;

    // engranaje (y su silueta, que tapa la herramienta por detrás)
    const gt = `translate(0 ${T.gy(ms)}) rotate(${T.gr(ms)} ${GC[0]} ${GC[1]}) translate(${GC[0]} ${GC[1] + 60}) ` +
      `scale(${T.gsx(ms)} ${T.gsy(ms)}) translate(${-GC[0]} ${-GC[1] - 60})`;
    set('l3-gear', gt);
    set('l3-sil', gt);

    // chorro de líquido
    const head = T.sHead(ms), tail = T.sTail(ms), lvl = T.lvl(ms);
    const bottom = Math.min(head, lvl + 2), top = Math.min(tail, bottom);
    const chorro = $('l3-stream');
    chorro.setAttribute('y', top);
    chorro.setAttribute('height', Math.max(0, bottom - top));
    // salpicaduras al primer contacto
    const sp = (ms - 1180) / 380;
    [['l3-sp1', -1, 1], ['l3-sp2', 1, 0.8]].forEach(([id, dir, k]) => {
      const el = $(id);
      if (sp > 0 && sp < 1) {
        el.style.opacity = 1 - sp;
        el.setAttribute('cx', 120.4 + dir * 22 * sp * k);
        el.setAttribute('cy', lvl - 4 - 30 * k * sp * (1 - sp) * 2.2);
      } else {
        el.style.opacity = 0;
      }
    });
    // nivel del líquido con ola
    const A = T.wave(ms), fase = ms * 0.012;
    let d = `M70,170 L70,${lvl}`;
    for (let x = 70; x <= 170; x += 4) d += ` L${x},${(lvl + A * Math.sin(x * 0.14 + fase)).toFixed(2)}`;
    $('l3-level').setAttribute('d', d + ' L170,170Z');

    // herramienta: entra en diagonal y vibra al clavarse
    const td = T.td(ms);
    const vib = ms > 2430 && ms < 2900 ? Math.sin((ms - 2430) * 0.09) * 2.2 * Math.exp(-(ms - 2430) / 120) : 0;
    set('l3-tool', `translate(${U[0] * td - U[1] * vib} ${U[1] * td + U[0] * vib})`);
    $('l3-tool').style.opacity = ms < 2050 ? 0 : 1;

    // letras
    L1.forEach((L) => {
      const a = K([[2650 + L.i * 70, 0], [3070 + L.i * 70, 1, 'back']])(ms);
      const b = K([[4080 + L.i * 25, 0], [4300 + L.i * 25, 1, 'inBack']])(ms);
      L.g.setAttribute('transform', `translate(${L.x} ${L.base + (1 - a) * 45 + b * 45}) rotate(${(1 - a) * -14 + b * 14}) scale(${0.5 + 0.5 * a})`);
      L.g.style.opacity = Math.min(1, a * 1.4) * (1 - b);
    });
    L2.forEach((L) => {
      const a = K([[3050 + L.i * 35, 0], [3350 + L.i * 35, 1, 'out3']])(ms);
      const b = K([[4080 + L.i * 15, 0], [4280 + L.i * 15, 1, 'in3']])(ms);
      L.g.setAttribute('transform', `translate(${L.x} ${L.base + (1 - a) * 14 + b * 30})`);
      L.g.style.opacity = a * (1 - b);
    });

    // el logo completo crece, toma impulso y sale
    const ls = T.ls(ms);
    set('l3-logo', `translate(0 ${T.ly(ms)}) translate(113 140) scale(${ls * T.lsx(ms)} ${ls * T.lsy(ms)}) translate(-113 -140)`);
    intro.style.clipPath = `circle(${T.cur(ms)}% at 50% -5%)`;

    if (svgEl.style.visibility !== 'visible') svgEl.style.visibility = 'visible'; // ya acomodado: se muestra
    if (paused) return;
    if (ms < END) raf = requestAnimationFrame(frame);
    else finish();
  }

  let terminada = false;
  function finish() {
    if (terminada) return;
    terminada = true;
    paused = true;
    cancelAnimationFrame(raf);
    intro.remove();
    document.documentElement.classList.remove('intro-activa');
    removeEventListener('resize', fit);
    document.removeEventListener('keydown', alTeclear);
    document.dispatchEvent(new Event('mice-intro-end'));
  }
  // Clic, toque, Esc, Enter o espacio la saltan.
  const alTeclear = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish(); };
  intro.addEventListener('click', finish);
  document.addEventListener('keydown', alTeclear);

  // Solo para revisar la animación (?depurar): miceIntro.ir(ms) congela la intro en ese instante y
  // miceIntro.pausas guarda los bloqueos del navegador (> 30 ms) mientras corre.
  if (new URLSearchParams(location.search).has('depurar')) {
    const pausas = [];
    let previo = performance.now();
    (function vigilar() {
      const t = performance.now();
      if (t - previo > 30) pausas.push(Math.round(t - previo));
      previo = t;
      if (!terminada) setTimeout(vigilar, 0);
    })();
    window.miceIntro = {
      ir: (ms) => { paused = true; cancelAnimationFrame(raf); anterior = null; transcurrido = ms * SPEED; frame(performance.now()); },
      END,
      pausas,
    };
  }
  raf = requestAnimationFrame(frame);
})();
