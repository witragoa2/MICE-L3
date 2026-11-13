import * as THREE from "three";

// Ejes: x = este, y = arriba, z = sur (AutoCAD Y norte = -z). θ = 0 mira desde el sur.
const VISTAS = {
  entrada: { theta: -Math.PI * 0.78, phi: 1.14, radio: 52, objetivo: [-10, 3, 0] },
  n: { theta: Math.PI, phi: 1.2 },
  s: { theta: 0, phi: 1.2 },
  e: { theta: Math.PI / 2, phi: 1.2 },
  o: { theta: -Math.PI / 2, phi: 1.2 },
  ne: { theta: Math.PI * 0.75, phi: 0.9 },
  no: { theta: -Math.PI * 0.75, phi: 0.9 },
  se: { theta: Math.PI * 0.25, phi: 0.9 },
  so: { theta: -Math.PI * 0.25, phi: 0.9 },
};

// Mismos colores que los planos 2D del L3.
const COLORES_AREA = {
  salon: "#f3e2c7",
  apoyo: "#1f5f73",
  grupo: "#8cc063",
  servicio: "#f2c94c",
  restringido: "#5f5f5f",
  bano: "#a9cfe8",
};

const COLORES_ESTRUCTURA = {
  muro: "#ece8e0",
  losa: "#c9ced5",
  columna: "#ece8e0",
  tapa_ventana: "#ece8e0",
  puerta: "#1c2c6b",
  puerta_emergencia: "#1f9d55",
  marco_puerta: "#b9c0c7",
  barandal: "#9aa4ae",
  escalera: "#b79bc8",
  techo: "#a3adb8",
  otro: "#cccccc",
};
const COLOR_ESCALERA_EMERGENCIA = "#d98b4a";
const COLOR_VIDRIO = "#5d8aa8";

const ASPECTO_REFERENCIA = 1.35; // ancho/alto con el que se diseñaron las distancias de cámara
const RADIO_NIVEL = 52; // distancia de la vista de un piso y máximo alejamiento en ella
const FOV_3D = 40;
const FOV_2D = 12; // lente estrecha: el plano 2D casi no tiene perspectiva
const ESCALA_2D = Math.tan(THREE.MathUtils.degToRad(FOV_3D / 2)) / Math.tan(THREE.MathUtils.degToRad(FOV_2D / 2));
const TAMANO_PASTO = 4000; // m; la niebla oculta su orilla
const SEPARACION = 6; // metros entre pisos al separarlos
const SUAVIZADO = 0.09;
const DORADO = 0xffc21a;
const NEGRO = new THREE.Color(0x000000);
const BRILLO_RESALTADO = new THREE.Color(0x7a5400);

/**
 * Devuelve una función que, cuando el trabajo seguido pasa de `presupuestoMs`, cede el turno al navegador
 * (para que la intro y la página sigan dibujando mientras se arma el modelo).
 */
function crearCeder(presupuestoMs = 6) {
  let inicio = performance.now();
  return async () => {
    if (performance.now() - inicio < presupuestoMs) return;
    await new Promise((r) => setTimeout(r, 0));
    inicio = performance.now();
  };
}

export class VisorEdificio {
  constructor(contenedor) {
    this.contenedor = contenedor;
    this.alSeleccionar = null;
    this.alCambiar2D = null;

    this.escena = new THREE.Scene();
    this.camara = new THREE.PerspectiveCamera(FOV_3D, 1, 0.3, 5000);
    this.modo2D = false;
    this.fovDeseado = FOV_3D;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // las sombras se recalculan solo si cambia la escena
    this.renderer.setClearColor(0x000000, 0);
    contenedor.appendChild(this.renderer.domElement);

    this.escena.add(new THREE.HemisphereLight(0xffffff, 0x9aa6b5, 1.9));
    this.sol = new THREE.DirectionalLight(0xffffff, 2.0);
    this.sol.position.set(30, 60, 25);
    this.sol.castShadow = true;
    this.sol.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sol.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
    this.sol.shadow.bias = -0.0005;
    this.escena.add(this.sol);
    const relleno = new THREE.DirectionalLight(0xffffff, 0.7);
    relleno.position.set(-40, 30, -30);
    this.escena.add(relleno);

    this.raiz = new THREE.Group();
    this.escena.add(this.raiz);

    this.niveles = [];
    this.techo = null;
    this.tapas = [];
    this.fachada = [];
    this.etiquetas = [];
    this.etiquetasVolteadas = null;
    this.etiquetasFlotan = null;
    this.areas = {};
    this.porCodigo = {};
    this.resaltados = [];
    this.separado = false;
    this.techoVisible = true;
    this.nivelActivo = "todos";
    this.raycaster = new THREE.Raycaster();
    this._candidatos = null;
    this._pendiente = true;
    this._listo = false; // no se dibuja hasta que el modelo y sus gráficos estén preparados
    this._ultimoHover = 0;

    this.actual = { theta: VISTAS.entrada.theta, phi: VISTAS.entrada.phi, radio: 80, objetivo: new THREE.Vector3(0, 4, 0) };
    this.deseado = { theta: VISTAS.entrada.theta, phi: VISTAS.entrada.phi, radio: 80, objetivo: new THREE.Vector3(0, 4, 0) };

    this._unirEventos();
    this._ajustarTamano();
    new ResizeObserver(() => this._ajustarTamano()).observe(contenedor);

    this.reloj = new THREE.Clock();
    this._animar = this._animar.bind(this);
    requestAnimationFrame(this._animar);
  }

  /** Pide redibujar; con escena=true también recalcula sombras y objetos clicables. */
  _marcar(escena = false) {
    this._pendiente = true;
    if (escena) {
      this.renderer.shadowMap.needsUpdate = true;
      this._candidatos = null;
    }
  }

  /* ---------------- entorno: cielo, pasto y plaza ---------------- */

  _crearEntorno() {
    const HORIZONTE = 0xd6e9f7;
    this.escena.fog = new THREE.Fog(HORIZONTE, 170, 520); // se recorre con la cámara en _animar

    // Cielo: degradado azul más intenso arriba.
    const cielo = new THREE.Mesh(
      new THREE.SphereGeometry(2400, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          arriba: { value: new THREE.Color(0x2f7fd6) },
          medio: { value: new THREE.Color(0x86bdea) },
          horizonte: { value: new THREE.Color(HORIZONTE) },
        },
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 arriba;
          uniform vec3 medio;
          uniform vec3 horizonte;
          varying vec3 vDir;
          void main() {
            float h = max(vDir.y, 0.0);
            vec3 c = mix(horizonte, medio, smoothstep(0.0, 0.18, h));
            c = mix(c, arriba, smoothstep(0.18, 0.75, h));
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      })
    );
    cielo.renderOrder = -10;
    this.escena.add(cielo);

    const pasto = new THREE.Mesh(
      new THREE.PlaneGeometry(TAMANO_PASTO, TAMANO_PASTO),
      new THREE.MeshStandardMaterial({ map: this._texturaPasto(), roughness: 1, metalness: 0 })
    );
    pasto.rotation.x = -Math.PI / 2;
    pasto.position.y = -0.1;
    pasto.receiveShadow = true;
    this.escena.add(pasto);

    // Plaza de adoquín: 2.5 m alrededor del L3 (contorno en coordenadas AutoCAD).
    const CX = 1325.27;
    const CY = 2458.79;
    const contorno = [
      [1297.67, 2442.29], [1310.17, 2442.29], [1310.17, 2447.19], [1352.87, 2447.19],
      [1352.87, 2465.29], [1336.62, 2465.29], [1336.62, 2475.29], [1326.72, 2475.29],
      [1326.72, 2465.29], [1297.67, 2465.29],
    ].map(([x, y]) => new THREE.Vector2(x - CX, y - CY));
    const plaza = new THREE.Mesh(
      new THREE.ShapeGeometry(new THREE.Shape(contorno)),
      new THREE.MeshStandardMaterial({ map: this._texturaHexagonal(), roughness: 0.95 })
    );
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = -0.075;
    plaza.receiveShadow = true;
    this.escena.add(plaza);
  }

  _texturaRepetible(canvas, repetirX, repetirY) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repetirX, repetirY);
    t.anisotropy = 8;
    return t;
  }

  /** Adoquín hexagonal de cemento gris (piezas de ~25 cm). */
  _texturaHexagonal() {
    const R = 30;
    const w = Math.sqrt(3) * R;
    const W = Math.round(2 * w);
    const H = 6 * R;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#6f7276";
    ctx.fillRect(0, 0, W, H);
    for (let fila = -1; fila <= 4; fila++) {
      const y = fila * 1.5 * R;
      const desfase = (((fila % 2) + 2) % 2) * (w / 2);
      for (let col = -1; col <= 2; col++) {
        const x = col * w + desfase;
        const tono = 168 + Math.floor(Math.random() * 22);
        ctx.fillStyle = `rgb(${tono}, ${tono + 1}, ${tono + 3})`;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const ang = Math.PI / 6 + (k * Math.PI) / 3;
          ctx.lineTo(x + (R - 2.2) * Math.cos(ang), y + (R - 2.2) * Math.sin(ang));
        }
        ctx.closePath();
        ctx.fill();
      }
    }
    const RADIO_M = 0.14;
    return this._texturaRepetible(c, 1 / ((W / R) * RADIO_M), 1 / ((H / R) * RADIO_M));
  }

  _texturaPasto() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#5e9a3c";
    ctx.fillRect(0, 0, 256, 256);
    const verdes = ["#4f8a32", "#6aa846", "#578f37", "#76b351", "#4a7f2e"];
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = verdes[i % verdes.length];
      ctx.globalAlpha = 0.35 + Math.random() * 0.45;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 2 + Math.random() * 4);
    }
    const repeticiones = TAMANO_PASTO * 0.15; // una baldosa de textura cada ~6.7 m
    return this._texturaRepetible(c, repeticiones, repeticiones);
  }

  /* ---------------- construcción ---------------- */

  /** Arma el edificio por partes y prepara los gráficos sin congelar la página. */
  async cargar(modelo, fachada = null) {
    const ceder = crearCeder();
    this._crearEntorno();
    await ceder();
    for (const nivel of modelo.niveles) {
      const grupo = new THREE.Group();
      this.raiz.add(grupo);
      this.niveles.push({ ...nivel, grupo, offset: 0, offsetDeseado: 0 });
    }
    this.techo = new THREE.Group();
    this.raiz.add(this.techo);

    for (const obj of modelo.estructura) {
      this._agregarEstructura(obj);
      await ceder();
    }
    for (const area of modelo.areas) {
      this._agregarArea(area);
      await ceder();
    }
    for (const salida of modelo.salidas || []) {
      const letrero = this._crearLetrero("SALIDA DE EMERGENCIA");
      letrero.position.set(...salida.posicion);
      this._contenedorDe(salida.nivel).add(letrero);
    }
    if (fachada) this.cargarFachada(fachada);
    this.setVentanas(Boolean(fachada));
    this.verEdificio(false);
    await this._prepararGraficos(ceder);
    this._listo = true;
    this._marcar(true);
  }

  /** Compila los shaders en segundo plano y sube las texturas poco a poco (si no, el primer cuadro tarda ~1 s). */
  async _prepararGraficos(ceder) {
    this.camara.position.set(0, 40, 80);
    this.camara.lookAt(this.actual.objetivo);
    this.camara.updateMatrixWorld();
    try {
      await this.renderer.compileAsync(this.escena, this.camara);
      // El plano 2D apaga la sombra del sol: esa variante también se prepara aquí.
      this.sol.castShadow = false;
      await this.renderer.compileAsync(this.escena, this.camara);
      this.sol.castShadow = true;
      // El shader de las sombras es interno de Three.js: se prepara aparte con un material igual,
      // compilado hacia un lienzo auxiliar como lo hace el mapa de sombras.
      // Con las mismas luces de la escena (el número de luces cambia la variante) y en las dos caras que usa la sombra.
      const prueba = new THREE.Scene();
      this.escena.traverse((o) => {
        if (o.isLight) prueba.add(o.clone());
      });
      for (const side of [THREE.DoubleSide, THREE.BackSide]) {
        prueba.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side })));
      }
      const auxiliar = new THREE.WebGLRenderTarget(1, 1);
      const anterior = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(auxiliar);
      await this.renderer.compileAsync(prueba, this.sol.shadow.camera);
      this.renderer.setRenderTarget(anterior);
      auxiliar.dispose();
    } catch {
      // sin compilación en paralelo: se compila en el primer cuadro
    }
    const texturas = new Set();
    this.escena.traverse((o) => {
      for (const m of [o.material].flat()) if (m?.map) texturas.add(m.map);
    });
    for (const t of texturas) {
      this.renderer.initTexture(t);
      await ceder();
    }

    // Sube la geometría a la tarjeta gráfica por lotes, dibujando en un solo píxel del lienzo (mismos shaders).
    const piezas = [];
    this.escena.traverse((o) => {
      if (o.isMesh || o.isLine || o.isSprite) piezas.push({ o, visible: o.visible, culling: o.frustumCulled });
    });
    for (const { o } of piezas) {
      o.visible = false;
      o.frustumCulled = false;
    }
    const r = this.renderer;
    const tamano = r.getSize(new THREE.Vector2());
    r.setViewport(0, 0, 1, 1);
    r.setScissor(0, 0, 1, 1);
    r.setScissorTest(true);
    r.shadowMap.needsUpdate = true; // la primera pasada prepara también las sombras
    for (let i = 0; i < piezas.length; i += 12) {
      for (const p of piezas.slice(i, i + 12)) p.o.visible = p.visible;
      r.render(this.escena, this.camara);
      await ceder();
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, tamano.x, tamano.y);
    for (const p of piezas) {
      p.o.visible = p.visible;
      p.o.frustumCulled = p.culling;
    }
  }

  /** Capa de ventanas (data/fachada.json). */
  cargarFachada(fachada) {
    const vidrio = { color: COLOR_VIDRIO, metalness: 0.4, roughness: 0.08, transparent: true, opacity: 0.45, depthWrite: false };
    const materiales = {
      vidrio,
      vidrio_torre: vidrio,
      marco: { color: "#8b939c", metalness: 0.55, roughness: 0.35 },
      persiana: { color: "#c3c8cd", metalness: 0.3, roughness: 0.5 },
    };
    for (const pieza of fachada.piezas || []) {
      if (!pieza.indices?.length) continue;
      const malla = new THREE.Mesh(
        this._geometria(pieza.vertices, pieza.indices),
        new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...(materiales[pieza.tipo] || materiales.marco) })
      );
      malla.userData.fachada = true;
      malla.castShadow = materiales[pieza.tipo] !== vidrio;
      this._contenedorDe(pieza.nivel).add(malla);
      this.fachada.push(malla);
    }
    this._marcar(true);
  }

  /** Ventanas sí: vidrio y hueco abierto. Ventanas no: muro cerrado (tapas). */
  setVentanas(visible) {
    for (const malla of this.fachada) malla.visible = visible;
    for (const tapa of this.tapas) tapa.visible = !visible;
    this._marcar(true);
  }

  _geometria(vertices, indices) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  _contenedorDe(nivel) {
    if (nivel === "techo") return this.techo;
    return this.niveles.find((n) => n.id === nivel)?.grupo || this.raiz;
  }

  _agregarEstructura(obj) {
    const geometria = this._geometria(obj.vertices, obj.indices);
    const emergencia = obj.tipo === "escalera" && obj.capa === "Escaleras de emergencia";
    const material = new THREE.MeshStandardMaterial({
      color: emergencia ? COLOR_ESCALERA_EMERGENCIA : COLORES_ESTRUCTURA[obj.tipo] || COLORES_ESTRUCTURA.otro,
      roughness: 0.85,
      metalness: 0.02,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    if (obj.tipo === "puerta_emergencia") {
      material.emissive.set("#1f9d55");
      material.emissiveIntensity = 0.45;
    } else if (obj.tipo === "puerta_vidrio") {
      Object.assign(material, { metalness: 0.4, roughness: 0.08, transparent: true, opacity: 0.5, depthWrite: false });
      material.color.set(COLOR_VIDRIO);
    } else if (obj.tipo === "barandal") {
      Object.assign(material, { metalness: 0.25, roughness: 0.4 });
    }

    const malla = new THREE.Mesh(geometria, material);
    malla.castShadow = obj.tipo !== "losa";
    malla.receiveShadow = true;
    if (obj.tipo === "tapa_ventana") this.tapas.push(malla);
    const destino = this._contenedorDe(obj.nivel);
    destino.add(malla);

    if (["muro", "losa", "techo", "escalera", "columna"].includes(obj.tipo)) {
      let aristas = new THREE.EdgesGeometry(geometria, 25);
      if (obj.tipo === "columna") aristas = this._soloVerticales(aristas);
      destino.add(new THREE.LineSegments(aristas, new THREE.LineBasicMaterial({ color: 0x5b6470, transparent: true, opacity: 0.45 })));
    }
  }

  /** Solo aristas verticales: las columnas se ven continuas entre pisos. */
  _soloVerticales(aristas) {
    const p = aristas.getAttribute("position").array;
    const salida = [];
    for (let i = 0; i < p.length; i += 6) {
      if (Math.abs(p[i + 1] - p[i + 4]) > 0.05) salida.push(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]);
    }
    aristas.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(salida, 3));
    return g;
  }

  _agregarArea(area) {
    const destino = this._contenedorDe(area.nivel);
    const color = COLORES_AREA[area.tipo] || COLORES_AREA.salon;

    const piso = new THREE.Mesh(
      this._geometria(area.piso.vertices, area.piso.indices),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide })
    );
    piso.receiveShadow = true;
    destino.add(piso);

    // Volumen invisible: recibe el clic y se ilumina al resaltar.
    const geoVolumen = this._geometria(area.vertices, area.indices);
    const volumen = new THREE.Mesh(
      geoVolumen,
      new THREE.MeshStandardMaterial({
        color: DORADO,
        emissive: DORADO,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    volumen.userData.areaId = area.id;
    volumen.renderOrder = 5;
    destino.add(volumen);

    const contorno = new THREE.LineSegments(
      new THREE.EdgesGeometry(geoVolumen, 20),
      new THREE.LineBasicMaterial({ color: DORADO, transparent: true, depthTest: false })
    );
    contorno.visible = false;
    contorno.renderOrder = 6;
    contorno.userData.esContorno = true;
    destino.add(contorno);

    const etiqueta = this._crearEtiqueta(area, area.etiqueta || area.codigo || area.nombre, Boolean(area.codigo));
    etiqueta.visible = false;
    destino.add(etiqueta);

    const datos = { ...area, piso, volumen, contorno, etiqueta, colorBase: color };
    this.areas[area.id] = datos;
    if (area.codigo) this.porCodigo[area.codigo] = datos;
  }

  /**
   * Nombre del salón en una caja que cabe dentro del propio salón, con el texto
   * repartido en las líneas que permiten la letra más grande. En 2D va sobre el
   * piso; en 3D flota por encima del salón mirando a la cámara.
   */
  _crearEtiqueta(area, texto, esSalon) {
    const ancho = (area.bbox[3] - area.bbox[0]) * 0.86;
    const fondo = (area.bbox[5] - area.bbox[2]) * 0.8;
    const LETRA = 64;
    const ALTO_LINEA = 74;
    const PAD_X = 22;
    const PAD_Y = 14;
    const maxLetra = esSalon ? 0.75 : 0.55;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const fuente = `bold ${LETRA}px Segoe UI, Arial`;
    ctx.font = fuente;

    const palabras = texto.replace(/ · /g, " ").split(/\s+/).filter(Boolean);
    const total = palabras.join(" ").length;
    const repartir = (n) => {
      const lineas = [];
      let actual = [];
      palabras.forEach((palabra, i) => {
        actual.push(palabra);
        const faltan = n - lineas.length - 1;
        if (faltan > 0 && (actual.join(" ").length >= total / n || palabras.length - i - 1 === faltan)) {
          lineas.push(actual.join(" "));
          actual = [];
        }
      });
      if (actual.length) lineas.push(actual.join(" "));
      return lineas;
    };

    let mejor = null;
    for (let n = 1; n <= Math.min(palabras.length, 4); n++) {
      const lineas = repartir(n);
      const w = Math.max(...lineas.map((l) => ctx.measureText(l).width)) + PAD_X * 2;
      const h = lineas.length * ALTO_LINEA + PAD_Y * 2;
      const escala = Math.min(maxLetra / LETRA, ancho / w, fondo / h);
      if (!mejor || escala > mejor.escala * 1.05) mejor = { lineas, w, h, escala };
    }

    canvas.width = Math.ceil(mejor.w);
    canvas.height = Math.ceil(mejor.h);
    ctx.fillStyle = esSalon ? "rgba(0, 43, 92, 0.94)" : "rgba(255, 255, 255, 0.94)";
    ctx.beginPath();
    ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 16);
    ctx.fill();
    ctx.strokeStyle = esSalon ? "#d4a72c" : "#002b5c";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.font = fuente;
    ctx.fillStyle = esSalon ? "#ffffff" : "#002b5c";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    mejor.lineas.forEach((linea, i) => ctx.fillText(linea, canvas.width / 2, PAD_Y + ALTO_LINEA * (i + 0.5) + 2));

    const textura = new THREE.CanvasTexture(canvas);
    textura.colorSpace = THREE.SRGBColorSpace;
    textura.anisotropy = 8;
    const malla = new THREE.Mesh(
      new THREE.PlaneGeometry(canvas.width * mejor.escala, canvas.height * mejor.escala),
      new THREE.MeshBasicMaterial({
        map: textura,
        transparent: true,
        alphaTest: 0.2,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      })
    );
    const [x, z] = area.posEtiqueta || [area.centro[0], area.centro[2]];
    malla.position.set(x, area.bbox[1] + 0.06, z);
    malla.userData.yPiso = area.bbox[1] + 0.06;
    malla.userData.yFlotante = area.bbox[4] + 0.6;
    malla.userData.areaId = area.id;
    malla.userData.base = malla.scale.clone();
    this.etiquetas.push(malla);
    return malla;
  }

  /** Letrero de "SALIDA DE EMERGENCIA" (sprite verde). */
  _crearLetrero(texto) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const fuente = "bold 44px Segoe UI, Arial";
    ctx.font = fuente;
    const ancho = Math.ceil(ctx.measureText(texto).width) + 48;
    canvas.width = ancho;
    canvas.height = 76;
    ctx.fillStyle = "#1f9d55";
    ctx.beginPath();
    ctx.roundRect(2, 2, ancho - 4, 72, 14);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.font = fuente;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(texto, ancho / 2, 40);

    const textura = new THREE.CanvasTexture(canvas);
    textura.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textura, transparent: true, depthWrite: false }));
    sprite.scale.set((0.72 * ancho) / 76, 0.72, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  /* ---------------- interacción ---------------- */

  _unirEventos() {
    const lienzo = this.renderer.domElement;
    lienzo.style.cursor = "grab";
    lienzo.style.touchAction = "none";
    let arrastre = null;
    let gesto = null; // dos dedos: pellizco para acercar y arrastre para mover
    const punteros = new Map();

    const medirGesto = () => {
      const [a, b] = [...punteros.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    lienzo.addEventListener("pointerdown", (e) => {
      punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        lienzo.setPointerCapture(e.pointerId);
      } catch {
        // puntero que ya no existe
      }
      if (punteros.size === 2) {
        arrastre = null;
        gesto = medirGesto();
        return;
      }
      if (punteros.size > 2) return;
      const pan = e.button === 2 || e.button === 1 || e.shiftKey;
      arrastre = { pan, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY };
      lienzo.style.cursor = pan ? "move" : "grabbing";
    });

    lienzo.addEventListener("pointermove", (e) => {
      if (punteros.has(e.pointerId)) punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesto && punteros.size >= 2) {
        const g = medirGesto();
        this._zoom(gesto.dist / g.dist);
        this._panear(g.x - gesto.x, g.y - gesto.y);
        gesto = g;
        this._marcar();
        return;
      }
      if (!arrastre) {
        // Cursor de mano sobre los salones (solo mouse, como máximo cada 50 ms).
        const t = performance.now();
        if (e.pointerType === "mouse" && t - this._ultimoHover > 50) {
          this._ultimoHover = t;
          lienzo.style.cursor = this._areaBajo(e) ? "pointer" : "grab";
        }
        return;
      }
      const dx = e.clientX - arrastre.x;
      const dy = e.clientY - arrastre.y;
      arrastre.x = e.clientX;
      arrastre.y = e.clientY;
      if (arrastre.pan || this.modo2D) {
        this._panear(dx, dy);
      } else {
        this.deseado.theta -= dx * 0.006;
        this.deseado.phi = THREE.MathUtils.clamp(this.deseado.phi - dy * 0.005, 0.15, 1.5);
        this.actual.theta = this.deseado.theta;
        this.actual.phi = this.deseado.phi;
      }
      this._marcar();
    });

    const soltar = (e, cancelado) => {
      punteros.delete(e.pointerId);
      if (gesto) {
        // Al levantar un dedo del pellizco, el otro sigue girando sin contar como clic.
        if (punteros.size < 2) gesto = null;
        const [resto] = punteros.values();
        arrastre = resto ? { pan: false, x: resto.x, y: resto.y, x0: -1e4, y0: -1e4 } : null;
        return;
      }
      if (!cancelado && arrastre && Math.hypot(e.clientX - arrastre.x0, e.clientY - arrastre.y0) < 8) {
        const area = this._areaBajo(e);
        if (area) {
          this.enfocarSalon(area.id);
          this.alSeleccionar?.(area);
        }
      }
      arrastre = null;
      lienzo.style.cursor = "grab";
    };
    lienzo.addEventListener("pointerup", (e) => soltar(e, false));
    lienzo.addEventListener("pointercancel", (e) => soltar(e, true));

    lienzo.addEventListener("contextmenu", (e) => e.preventDefault());
    lienzo.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this._zoom(Math.exp(e.deltaY * 0.001));
        this._marcar();
      },
      { passive: false }
    );
    lienzo.addEventListener("dblclick", () => this.verEdificio(true, true));
  }

  /** Acerca (factor < 1) o aleja la cámara; con un piso elegido no se aleja más que su vista. */
  _zoom(factor) {
    const k = this.modo2D ? ESCALA_2D : 1;
    const maximo = (this.nivelActivo === "todos" ? 220 : RADIO_NIVEL) * k;
    this.deseado.radio = THREE.MathUtils.clamp(this.deseado.radio * factor, 6 * k, maximo);
  }

  /** Objetos que pueden recibir el clic (se recalcula solo si cambia la escena). */
  _objetosClicables() {
    if (!this._candidatos) {
      this._candidatos = [];
      this.raiz.traverseVisible((o) => {
        if (o.isMesh && !o.material.userData.fantasma && !o.userData.fachada) this._candidatos.push(o);
      });
    }
    return this._candidatos;
  }

  _areaBajo(evento) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const puntero = new THREE.Vector2(((evento.clientX - r.left) / r.width) * 2 - 1, -((evento.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(puntero, this.camara);
    for (const hit of this.raycaster.intersectObjects(this._objetosClicables(), false)) {
      const id = hit.object.userData.areaId;
      if (id) return this.areas[id];
      if (hit.object.material.opacity > 0.5) return null; // muro, losa o techo de por medio
    }
    return null;
  }

  _panear(dx, dy) {
    const alto = this.renderer.domElement.clientHeight || 1;
    const factor = (2 * this.deseado.radio * this._factorAspecto * Math.tan(THREE.MathUtils.degToRad(this.camara.fov / 2))) / alto;
    const derecha = new THREE.Vector3().setFromMatrixColumn(this.camara.matrixWorld, 0);
    const arriba = new THREE.Vector3().setFromMatrixColumn(this.camara.matrixWorld, 1);
    this.deseado.objetivo.addScaledVector(derecha, -dx * factor).addScaledVector(arriba, dy * factor);
    this.deseado.objetivo.clamp(new THREE.Vector3(-60, -2, -40), new THREE.Vector3(60, 30, 40));
    this.actual.objetivo.copy(this.deseado.objetivo);
  }

  /* ---------------- pisos ---------------- */

  _alturaPiso(id) {
    const nivel = this.niveles.find((n) => n.id === Number(id));
    return nivel ? nivel.piso + nivel.offsetDeseado : 0;
  }

  _aplicarOffsets() {
    for (const n of this.niveles) n.offsetDeseado = this.separado ? n.id * SEPARACION : 0;
  }

  /** Vuelve transparente (o normal) un piso completo. */
  _fantasma(grupo, activo) {
    grupo.traverse((o) => {
      if (!o.material || o.isSprite) return;
      const m = o.material;
      if (m.userData.opacidadBase === undefined) {
        m.userData.opacidadBase = m.opacity;
        m.userData.transparenteBase = m.transparent;
        o.userData.sombraBase = o.castShadow;
      }
      m.userData.fantasma = activo;
      if (o.userData.areaId || o.userData.esContorno) return;
      o.castShadow = activo ? false : o.userData.sombraBase;
      m.transparent = activo || m.userData.transparenteBase;
      m.opacity = activo ? 0.1 : m.userData.opacidadBase;
      m.depthWrite = !activo;
    });
  }

  /** ¿La etiqueta del área va en este piso? (los baños P2 también se ven desde el segundo piso) */
  _etiquetaEnPiso(area, nivel) {
    return area.nivel === nivel || (!this.separado && Boolean(area.nivelesEtiqueta?.includes(nivel)));
  }

  /** Nombres visibles: los del piso activo; en "Edificio", si está abierto, y siempre los resaltados. */
  _mostrarEtiquetas(nivelId) {
    const todos = nivelId === "todos";
    const edificioAbierto = todos && (this.separado || !this.techoVisible);
    for (const area of Object.values(this.areas)) {
      area.etiqueta.visible = edificioAbierto
        || (!todos && this._etiquetaEnPiso(area, Number(nivelId)))
        || (todos && this.resaltados.includes(area));
    }
  }

  _actualizarVisibilidad() {
    const activo = this.nivelActivo;
    for (const n of this.niveles) {
      if (activo === "todos") {
        n.grupo.visible = true;
        this._fantasma(n.grupo, false);
      } else if (this.separado) {
        n.grupo.visible = true;
        this._fantasma(n.grupo, n.id !== Number(activo));
      } else {
        n.grupo.visible = n.id <= Number(activo);
        this._fantasma(n.grupo, false);
      }
    }
    this.techo.visible = activo === "todos" && this.techoVisible && !this.modo2D;
    this._mostrarEtiquetas(activo);
    this._marcar(true);
  }

  setTecho(visible) {
    this.techoVisible = visible;
    this._actualizarVisibilidad();
  }

  /** Separa o junta los pisos verticalmente. */
  separar(activo) {
    this.separado = activo;
    this._aplicarOffsets();
    this._actualizarVisibilidad();
    if (this.nivelActivo === "todos") {
      this.deseado.objetivo.y = activo ? 9 : 4;
      this.deseado.radio = activo ? 95 : 80;
    } else {
      this.deseado.objetivo.y = this._alturaPiso(this.nivelActivo) + 1.5;
    }
  }

  /* ---------------- cámara y resaltado ---------------- */

  /** Ángulo equivalente más cercano al actual: siempre gira por el lado corto. */
  _anguloCercano(theta) {
    const vuelta = Math.PI * 2;
    return theta + Math.round((this.deseado.theta - theta) / vuelta) * vuelta;
  }

  /** Plano 2D: vista cenital de un piso, orientada como los planos. */
  set2D(activo) {
    if (activo === this.modo2D) return;
    this.modo2D = activo;
    this.fovDeseado = activo ? FOV_2D : FOV_3D;
    this.sol.castShadow = !activo;
    if (activo) {
      if (this.separado) {
        this.separado = false;
        this._aplicarOffsets();
      }
      if (this.nivelActivo === "todos") {
        this.enfocarNivel(0, true);
      } else {
        this.deseado.radio = Math.min(this.deseado.radio, RADIO_NIVEL);
        this._actualizarVisibilidad();
        this._ajustar2D();
      }
    } else {
      this.deseado.radio /= ESCALA_2D;
      this.deseado.phi = 0.72;
      this._actualizarVisibilidad();
    }
    this.alCambiar2D?.(activo);
  }

  /** Cámara arriba del piso, con Jefatura a la derecha. */
  _ajustar2D() {
    if (!this.modo2D) return;
    this.deseado.phi = 0.0015;
    this.deseado.theta = this._anguloCercano(Math.PI);
    this.deseado.radio *= ESCALA_2D;
  }

  vista(nombre, conservarResaltado = false) {
    const v = VISTAS[nombre] || VISTAS.entrada;
    this.set2D(false);
    if (!conservarResaltado) this.limpiarResaltado();
    this.nivelActivo = "todos";
    this._actualizarVisibilidad();
    if (v.objetivo && !this.separado) {
      this.deseado.objetivo.set(...v.objetivo);
      this.deseado.radio = v.radio;
    } else {
      this.deseado.objetivo.set(0, this.separado ? 9 : 4, 0);
      this.deseado.radio = this.separado ? 95 : ["n", "s", "e", "o"].includes(nombre) ? 85 : 80;
    }
    this.deseado.theta = this._anguloCercano(v.theta);
    this.deseado.phi = v.phi;
  }

  verEdificio(animar = true, conservarResaltado = false) {
    this.vista("entrada", conservarResaltado);
    if (!animar) {
      Object.assign(this.actual, { theta: this.deseado.theta, phi: this.deseado.phi, radio: this.deseado.radio });
      this.actual.objetivo.copy(this.deseado.objetivo);
    }
  }

  enfocarNivel(id, conservarResaltado = false) {
    if (!this.niveles.some((n) => n.id === Number(id))) return;
    if (!conservarResaltado) this.limpiarResaltado();
    this.nivelActivo = Number(id);
    this._actualizarVisibilidad();
    this.deseado.objetivo.set(0, this._alturaPiso(id) + 1.5, 0);
    this.deseado.radio = RADIO_NIVEL;
    this.deseado.phi = 0.72;
    this._ajustar2D();
  }

  enfocarSalon(codigoOId) {
    const area = this.porCodigo[codigoOId] || this.areas[codigoOId];
    if (!area) return false;
    this.enfocarNivel(area.nivel, true);
    this.resaltar(area);
    const nivel = this.niveles.find((n) => n.id === area.nivel);
    this.deseado.objetivo.set(area.centro[0], area.centro[1] + nivel.offsetDeseado + 1.2, area.centro[2]);
    this.deseado.radio = 21;
    this.deseado.phi = 0.8;
    this._ajustar2D();
    return true;
  }

  /**
   * Resalta varios salones. Si están en un piso, enfoca ese piso; si están en
   * varios, separa los pisos (en 2D usa el piso con más salones).
   */
  enfocarSalones(codigos) {
    const areas = [...new Set(codigos)].map((c) => this.porCodigo[c] || this.areas[c]).filter(Boolean);
    if (areas.length <= 1) {
      if (areas.length) this.enfocarSalon(areas[0].id);
      return areas.length;
    }
    let niveles = [...new Set(areas.map((a) => a.nivel))];
    if (this.modo2D && niveles.length > 1) {
      const conteo = (n) => areas.filter((a) => a.nivel === n).length;
      niveles = [niveles.sort((a, b) => conteo(b) - conteo(a))[0]];
    }
    if (niveles.length === 1) {
      this.enfocarNivel(niveles[0]);
    } else {
      this.limpiarResaltado();
      this.separado = true;
      this._aplicarOffsets();
      this.nivelActivo = "todos";
      this._actualizarVisibilidad();
      this.techo.visible = false;
      this.deseado.theta = this._anguloCercano(VISTAS.entrada.theta);
      this.deseado.phi = 1.0;
      this.deseado.radio = 82;
      this.deseado.objetivo.set(-4, 9, 0);
    }
    this.resaltar(areas, niveles.length === 1);
    return areas.length;
  }

  resaltar(areas, etiquetasDelPiso = true) {
    this.limpiarResaltado();
    const lista = Array.isArray(areas) ? areas : [areas];
    if (etiquetasDelPiso) {
      const niveles = new Set(lista.map((a) => a.nivel));
      for (const otra of Object.values(this.areas)) {
        if ([...niveles].some((n) => this._etiquetaEnPiso(otra, n))) otra.etiqueta.visible = true;
      }
    }
    for (const area of lista) {
      area.contorno.visible = true;
      area.piso.material.color.set(DORADO);
      area.piso.material.emissive.copy(BRILLO_RESALTADO);
      area.etiqueta.material.color.set(0xffe08a);
      area.etiqueta.visible = true;
    }
    this.resaltados = lista;
    this._marcar(true);
  }

  limpiarResaltado() {
    for (const area of this.resaltados) {
      area.contorno.visible = false;
      area.volumen.material.opacity = 0;
      area.piso.material.color.set(area.colorBase);
      area.piso.material.emissive.copy(NEGRO);
      area.etiqueta.material.color.set(0xffffff);
      area.etiqueta.scale.copy(area.etiqueta.userData.base);
    }
    this.resaltados = [];
    this._marcar();
  }

  /* ---------------- ciclo de dibujo ---------------- */

  _ajustarTamano() {
    const ancho = this.contenedor.clientWidth || 640;
    const alto = this.contenedor.clientHeight || 480;
    this.camara.aspect = ancho / alto;
    this.camara.updateProjectionMatrix();
    // Pantalla vertical (celular): la cámara se aleja para que el edificio quepa a lo ancho.
    this._factorAspecto = THREE.MathUtils.clamp(ASPECTO_REFERENCIA / this.camara.aspect, 1, 2.6);
    this.renderer.setSize(ancho, alto, false);
    this._marcar();
  }

  /** Acerca un valor al deseado; devuelve true si todavía se está moviendo. */
  _acercar(objeto, clave, meta, minimo) {
    const dif = meta - objeto[clave];
    if (Math.abs(dif) < minimo) {
      objeto[clave] = meta;
      return false;
    }
    objeto[clave] += dif * SUAVIZADO;
    return true;
  }

  _animar() {
    requestAnimationFrame(this._animar);
    if (!this._listo) return;
    const a = this.actual;
    const d = this.deseado;

    let camaraMovida = this._acercar(a, "theta", d.theta, 1e-4);
    camaraMovida = this._acercar(a, "phi", d.phi, 1e-5) || camaraMovida;
    camaraMovida = this._acercar(a, "radio", d.radio, 1e-3) || camaraMovida;
    if (a.objetivo.distanceToSquared(d.objetivo) > 1e-6) {
      a.objetivo.lerp(d.objetivo, SUAVIZADO);
      camaraMovida = true;
    } else {
      a.objetivo.copy(d.objetivo);
    }
    if (this._acercar(this.camara, "fov", this.fovDeseado, 0.01)) {
      this.camara.updateProjectionMatrix();
      camaraMovida = true;
    }

    let pisosMovidos = false;
    for (const n of this.niveles) {
      if (this._acercar(n, "offset", n.offsetDeseado, 1e-3)) pisosMovidos = true;
      n.grupo.position.y = n.offset;
    }
    if (this.techo) this.techo.position.y = this.niveles.at(-1)?.offset ?? 0;
    if (pisosMovidos) this._marcar(true);

    // Sin cambios ni salones parpadeando, no se vuelve a dibujar.
    if (!camaraMovida && !this._pendiente && !this.resaltados.length) return;
    this._pendiente = false;

    const radio = a.radio * this._factorAspecto;
    this.camara.position.set(
      a.objetivo.x + radio * Math.sin(a.phi) * Math.sin(a.theta),
      a.objetivo.y + radio * Math.cos(a.phi),
      a.objetivo.z + radio * Math.sin(a.phi) * Math.cos(a.theta)
    );
    this.camara.lookAt(a.objetivo);

    // Niebla del horizonte a partir del edificio: en 2D (vista desde arriba) y en celular, donde
    // la cámara está más lejos, no deslava el plano.
    this.escena.fog.near = radio + 120;
    this.escena.fog.far = radio + 470;

    // Plano "near" más lejos en 2D para que el piso no se mezcle con la losa.
    const near = this.modo2D ? Math.max(0.5, radio * 0.6) : 0.3;
    if (Math.abs(this.camara.near - near) > 0.05) {
      this.camara.near = near;
      this.camara.updateProjectionMatrix();
    }

    this._orientarEtiquetas();

    if (this.resaltados.length) {
      const pulso = 0.5 + 0.5 * Math.sin(this.reloj.getElapsedTime() * 4);
      const k = 1 + 0.08 * pulso;
      for (const area of this.resaltados) {
        area.contorno.material.opacity = 0.35 + 0.65 * pulso;
        area.volumen.material.opacity = 0.12 + 0.22 * pulso;
        area.piso.material.emissiveIntensity = 0.3 + 0.5 * pulso;
        area.etiqueta.scale.copy(area.etiqueta.userData.base).multiplyScalar(k);
      }
    }

    this.renderer.render(this.escena, this.camara);
  }

  /** En 3D las etiquetas flotan de frente a la cámara; en 2D van sobre el piso. */
  _orientarEtiquetas() {
    const flotan = !this.modo2D;
    if (flotan !== this.etiquetasFlotan) {
      this.etiquetasFlotan = flotan;
      this.etiquetasVolteadas = null;
      for (const e of this.etiquetas) {
        e.position.y = flotan ? e.userData.yFlotante : e.userData.yPiso;
        e.material.depthTest = !flotan;
        e.material.depthWrite = !flotan;
        e.renderOrder = flotan ? 10 : 4;
      }
    }
    if (flotan) {
      for (const e of this.etiquetas) if (e.visible) e.quaternion.copy(this.camara.quaternion);
      return;
    }
    const voltear = Math.cos(this.actual.theta) > 0;
    if (voltear !== this.etiquetasVolteadas) {
      this.etiquetasVolteadas = voltear;
      for (const e of this.etiquetas) e.rotation.set(-Math.PI / 2, 0, voltear ? 0 : Math.PI);
    }
  }
}
