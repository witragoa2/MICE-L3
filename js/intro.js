/* Intro animada de MICE L3: el ratón busca, encuentra el símbolo y da paso a la página.
   Se muestra una vez por visita; clic, toque o Esc la saltan. */
(function(){
  const SPEED = 0.763;             // velocidad global: 0.763 = 5 s (más bajo = más rápido)
  const intro = document.getElementById('mice-intro');
  if(!intro) return;
  // Una vez por visita (sessionStorage) y nunca con "reducir movimiento".
  let yaVista = false;
  try { yaVista = sessionStorage.getItem('mice-intro-vista') === '1'; } catch {}
  if(yaVista || matchMedia('(prefers-reduced-motion: reduce)').matches){ intro.remove(); return; }
  try { sessionStorage.setItem('mice-intro-vista', '1'); } catch {}
  document.documentElement.classList.add('intro-activa');  // la página de atrás no se desplaza
  const $ = id => document.getElementById(id);
  const NS='http://www.w3.org/2000/svg';
  const svgEl=document.querySelector('#mice-intro svg');

  // ---- leyenda letra por letra (letras en trazos, misma tipografía que el logo SVG) ----
  const GLYPHS = [
    { x: 83.9, d: `
        M105.408 502.092 V540 H96.174 V517.266 L87.696 540 H80.244 L71.712 517.212 V540 H62.478 V502.092
        H73.386 L84.024 528.336 L94.554 502.092Z` },
    { x: 123.7, d: "M128.284 502.092V540H119.05V502.092Z" },
    { x: 159.2, d: `
        M159.476 501.66 Q166.226 501.66 171.032 505.224 Q175.838 508.788 177.458 514.944 H167.306
        Q166.172 512.568 164.093 511.326 Q162.014 510.084 159.368 510.084 Q155.102 510.084 152.456
        513.054 Q149.81 516.024 149.81 520.992 Q149.81 525.96 152.456 528.93 Q155.102 531.9 159.368
        531.9 Q162.014 531.9 164.093 530.658 Q166.172 529.416 167.306 527.04 H177.458 Q175.838 533.196
        171.032 536.733 Q166.226 540.27 159.476 540.27 Q153.968 540.27 149.621 537.813 Q145.274 535.356
        142.844 530.982 Q140.414 526.608 140.414 520.992 Q140.414 515.376 142.844 510.975 Q145.274
        506.574 149.621 504.117 Q153.968 501.66 159.476 501.66Z` },
    { x: 201.4, d: `
        M199.362 509.49 V517.158 H211.728 V524.286 H199.362 V532.602 H213.348 V540 H190.128 V502.092
        H213.348 V509.49Z` },
    { x: 254.3, d: "M254.024 532.872H266.12V540H244.79V502.092H254.024Z" },
    { x: 290.5, d: `
        M290.4 499.662 Q294.45 499.662 297.339 501.066 Q300.228 502.47 301.713 504.9 Q303.198 507.33
        303.198 510.354 Q303.198 513.918 301.416 516.159 Q299.634 518.4 297.258 519.21 V519.426 Q300.336
        520.452 302.118 522.828 Q303.9 525.204 303.9 528.93 Q303.9 532.278 302.361 534.843 Q300.822
        537.408 297.879 538.866 Q294.936 540.324 290.886 540.324 Q284.406 540.324 280.545 537.138
        Q276.684 533.952 276.468 527.526 H285.432 Q285.486 529.902 286.782 531.279 Q288.078 532.656
        290.562 532.656 Q292.668 532.656 293.829 531.441 Q294.99 530.226 294.99 528.228 Q294.99 525.636
        293.343 524.475 Q291.696 523.314 288.078 523.314 H286.35 V515.808 H288.078 Q290.832 515.808
        292.533 514.863 Q294.234 513.918 294.234 511.488 Q294.234 509.544 293.154 508.464 Q292.074
        507.384 290.184 507.384 Q288.132 507.384 287.133 508.626 Q286.134 509.868 285.972 511.704
        H276.954 Q277.17 505.926 280.734 502.794 Q284.298 499.662 290.4 499.662Z` }
  ];
  const letters=GLYPHS.map((G,i)=>{ const g=document.createElementNS(NS,'g'), p=document.createElementNS(NS,'path');
    p.setAttribute('d',G.d); p.setAttribute('class','w'); p.setAttribute('transform',`translate(${-G.x} -540)`);
    g.appendChild(p); $('mi-text').appendChild(g); return {g,x:G.x,i}; });

  // ---- curvas de suavizado ----
  const E={
    lin:t=>t,
    io:t=>-(Math.cos(Math.PI*t)-1)/2,                 // seno: suave
    out:t=>Math.sin(t*Math.PI/2),
    in:t=>1-Math.cos(t*Math.PI/2),
    out3:t=>1-Math.pow(1-t,3), in3:t=>t*t*t,
    back:t=>{const c=1.5;return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2)},
    inBack:t=>{const c=1.5;return (c+1)*t*t*t-c*t*t},
    elastic:t=>t===0||t===1?t:Math.pow(2,-9*t)*Math.sin((t*8-.75)*2.094)+1
  };
  const K = keys => ms => {
    if(ms<=keys[0][0]) return keys[0][1];
    for(let i=1;i<keys.length;i++){ const [t1,v1,e]=keys[i], [t0,v0]=keys[i-1];
      if(ms<=t1){ return v0+(v1-v0)*(E[e||'io'])((ms-t0)/(t1-t0)); } }
    return keys[keys.length-1][1];
  };

  // ================= LÍNEA DE TIEMPO (ms) =================
  const T = {
    // posición de la cabeza
    x : K([[0,300],[3020,300],[3400,0,'io']]),
    y : K([[0,640],[800,40,'out3'],[1050,60,'io'],
           [2240,60],[2330,40,'out'],[2420,60,'in'],[2520,60],[2680,22,'out'],[2840,60,'in'],
           [2960,60],[3180,-35,'out'],[3400,0,'in']]),
    // aplastar / estirar (pivote abajo de la cabeza)
    sx: K([[0,.92],[800,.97],[1050,1,'out'],
           [2480,1],[2540,1.07,'out'],[2620,.95,'out'],[2780,1],[2840,1.06,'out'],[2940,1,'out'],
           [2960,1],[3040,1.1,'out'],[3110,.94,'out'],[3300,1],[3400,1],[3470,1.07,'out'],[3650,1,'io']]),
    sy: K([[0,1.08],[800,1.03],[1050,1,'out'],
           [2480,1],[2540,.93,'out'],[2620,1.06,'out'],[2780,1],[2840,.94,'out'],[2940,1,'out'],
           [2960,1],[3040,.9,'out'],[3110,1.08,'out'],[3300,1],[3400,1],[3470,.93,'out'],[3650,1,'io']]),
    sc: K([[0,1]]),
    rot:K([[0,8],[800,-3,'io'],[1100,0,'io'],
           [1150,0],[1450,-10,'io'],[1800,9,'io'],[2050,0,'io'],
           [3040,0],[3180,8,'out'],[3400,-3,'io'],[3600,0,'io']]),
    // giro de la cabeza (de mirar a la derecha a mirar a la izquierda)
    fh: K([[2260,-1],[2400,1,'io']]),
    blink: K([[1600,1],[1660,.08,'in'],[1750,1,'out']]),
    happy: K([[2400,0],[2460,1,'lin']]),
    // signos
    qs: K([[1150,0],[1450,1,'back'],[2120,1],[2280,0,'inBack']]),
    es: K([[2380,0],[2580,1,'back'],[2900,1],[3040,0,'inBack']]),
    // símbolo de búsqueda
    ps: K([[1500,0],[2200,1,'elastic'],[3400,1],[3480,1.05,'out'],[3640,.98,'io'],[3780,1,'io']]),
    pr: K([[1500,-25],[2200,0,'elastic'],[3400,0],[3480,-3,'io'],[3600,2,'io'],[3720,0,'io']]),
    // circuitos
    cc: K([[3700,0],[4200,1,'out3'],[5800,1],[6050,0,'in3']]),
    // logo completo
    ls: K([[4100,1],[4550,1.08,'back']]),
    lsx:K([[5850,1],[5960,1.05,'out'],[6220,.92,'in3']]),
    lsy:K([[5850,1],[5960,.93,'out'],[6220,1.28,'in3']]),
    ly: K([[5850,0],[5960,16,'out'],[6220,-820,'in3']]),
    cur:K([[6050,160],[6550,0,'io']]),
  };
  const END = 6550;

  // Cámara en pantallas verticales (celular): al inicio abierta y corrida a la derecha para que
  // quepan el ratón y el "?"; cuando salta al símbolo se centra y se acerca (logo centrado al final).
  const CAM_X = K([[0,640],[3000,640],[3500,500,'io']]);   // centro horizontal (unidades del SVG)
  const CAM_W = K([[0,680],[3000,680],[3500,540,'io']]);   // ancho visible
  const CAM_Y = 300;                                      // centro vertical del logo
  let vista = '';
  function encuadre(ms){
    const asp = innerWidth/innerHeight;
    let v = '0 0 1000 600';
    if(asp < 0.9){
      const w = CAM_W(ms), h = w/asp;
      v = `${(CAM_X(ms)-w/2).toFixed(1)} ${(CAM_Y-h/2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;
    }
    if(v !== vista){ svgEl.setAttribute('viewBox', v); vista = v; }
  }

  const set=(id,v)=>$(id).setAttribute('transform',v);

  // Tiempo propio de la animación: si el navegador se traba un momento, avanza máximo 40 ms por cuadro
  // (sigue donde iba en lugar de brincar hacia adelante).
  let anterior=null, transcurrido=0, raf, paused=false;
  function frame(now){
    if(anterior===null) anterior=now;
    transcurrido += Math.min(now-anterior, 40); anterior=now;
    const ms=transcurrido/SPEED;
    encuadre(ms);

    // flotación suave mientras está solo
    const float = ms<2960 ? Math.sin(ms*.0045)*4 : 0;
    const sc=T.sc(ms);
    set('mi-rat',`translate(${T.x(ms)} ${T.y(ms)+float}) rotate(${T.rot(ms)} 185 200) translate(190 295) scale(${T.sx(ms)*sc} ${T.sy(ms)*sc}) translate(-190 -295)`);
    // giro: se encoge un poquito al pasar de perfil
    // giro limpio: nunca se ve "de canto", cambia de lado mientras se achata un poco
    const f=T.fh(ms), mid=1-Math.abs(f), fx=(f<0?-1:1)*(.55+.45*Math.abs(f));
    set('mi-headflip',`translate(180 190) scale(${fx} ${1+mid*.06}) translate(-180 -190)`);
    const hp=T.happy(ms);
    set('mi-eye',`translate(142.1 176.8) scale(1 ${Math.max(.05,T.blink(ms)*(1-hp))}) translate(-142.1 -176.8)`);
    $('mi-eyeh').style.opacity=hp; $('mi-smile').style.opacity=hp;
    const fl=Math.sin(ms*.005)*4;
    set('mi-q',`translate(310 ${44+fl}) rotate(${Math.sin(ms*.006)*10}) scale(${T.qs(ms)})`);
    set('mi-ex',`translate(66 ${44-fl}) rotate(${Math.sin(ms*.012)*5}) scale(${T.es(ms)})`);

    set('mi-pin',`translate(183 230) rotate(${T.pr(ms)}) scale(${T.ps(ms)}) translate(-183 -230)`);
    $('mi-pin').style.opacity = ms<1500?0:1;

    const cc=T.cc(ms); $('mi-crect').setAttribute('height',150*cc);
    set('mi-circ',`translate(0 ${(1-cc)*-30})`);

    letters.forEach(L=>{
      const a=K([[3850+L.i*80,0],[4300+L.i*80,1,'back']])(ms);
      const b=K([[5760+L.i*40,0],[6000+L.i*40,1,'inBack']])(ms);
      const yy=540+(1-a)*110+b*100, s=.5+.5*a;
      L.g.setAttribute('transform',`translate(${L.x} ${yy}) rotate(${(1-a)*-14+b*14}) scale(${s})`);
      L.g.style.opacity=Math.min(1,a*1.4)*(1-b);
    });

    const ls=T.ls(ms);
    set('mi-logo',`translate(0 ${T.ly(ms)}) translate(183 270) scale(${ls*T.lsx(ms)} ${ls*T.lsy(ms)}) translate(-183 -270)`);
    intro.style.clipPath=`circle(${T.cur(ms)}% at 50% -5%)`;

    if(svgEl.style.visibility !== 'visible') svgEl.style.visibility = 'visible'; // ya acomodado: se muestra
    if(paused) return;
    if(ms<END) raf=requestAnimationFrame(frame); else finish();
  }
  let terminada = false;
  function finish(){
    if(terminada) return;
    terminada = true; paused = true;
    cancelAnimationFrame(raf); intro.remove();
    document.documentElement.classList.remove('intro-activa');
    document.removeEventListener('keydown', alTeclear);
    document.dispatchEvent(new Event('mice-intro-end'));
  }
  // Clic, toque, Esc, Enter o espacio la saltan.
  const alTeclear = e => { if(e.key==='Escape'||e.key==='Enter'||e.key===' ') finish(); };
  intro.addEventListener('click',finish);
  document.addEventListener('keydown', alTeclear);
  // Solo para revisar la animación (?depurar): miceIntro.ir(ms) congela la intro en ese instante.
  if(new URLSearchParams(location.search).has('depurar')){
    // miceIntro.pausas: bloqueos del navegador (> 30 ms) mientras corre la intro, para medir tirones.
    const pausas = []; let previo = performance.now();
    (function vigilar(){ const t = performance.now(); if(t - previo > 30) pausas.push(Math.round(t - previo)); previo = t; if(!terminada) setTimeout(vigilar, 0); })();
    window.miceIntro = { ir: ms => { paused=true; cancelAnimationFrame(raf); anterior=null; transcurrido=ms*SPEED; frame(performance.now()); }, END, pausas };
  }
  encuadre(0);
  raf=requestAnimationFrame(frame);
})();
