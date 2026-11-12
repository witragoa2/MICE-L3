import * as THREE from "three";

// Orientación: AutoCAD Y (norte) = -z en Three.js. θ = 0 mira desde el sur.
const VISTAS = {
  // Vista inicial: fachada norte con la escalera de emergencia y, a la derecha,
  // el cancel de vidrio de la entrada.
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
export const COLORES_AREA = {
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
  puerta: "#1c2c6b",
  tapa_ventana: "#ece8e0",
  puerta_emergencia: "#1f9d55",
  marco_puerta: "#b9c0c7",
  columna: "#ece8e0",
  barandal: "#9aa4ae",
  escalera: "#b79bc8",
  techo: "#a3adb8",
  otro: "#cccccc",
};

const RADIO_NIVEL = 52; // distancia de la vista de un piso = máximo alejamiento en ese modo
const SEPARACION = 6; // metros extra entre pisos al separarlos
const DORADO = 0xffc21a;

export class VisorEdificio {
  constructor(contenedor) {
    this.contenedor = contenedor;
    this.alSeleccionar = null; // callback(area) al hacer clic en un salón

    this.escena = new THREE.Scene();
    this.camara = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    contenedor.appendChild(this.renderer.domElement);

    this.escena.add(new THREE.HemisphereLight(0xffffff, 0x9aa6b5, 1.9));
    const sol = new THREE.DirectionalLight(0xffffff, 2.0);
    sol.position.set(30, 60, 25);
    sol.castShadow = true;
    sol.shadow.mapSize.set(2048, 2048);
    Object.assign(sol.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
    sol.shadow.bias = -0.0005;
    this.escena.add(sol);
    const relleno = new THREE.DirectionalLight(0xffffff, 0.7);
    relleno.position.set(-40, 30, -30);
    this.escena.add(relleno);

    this._crearEntorno();

    this.raiz = new THREE.Group();
    this.escena.add(this.raiz);

    this.niveles = []; // {id, nombre, piso, grupo, offset, offsetDeseado}
    this.techo = null;
    this.tapas = []; // muro que cierra los huecos de ventana cuando se apagan
    this.areas = {}; // id -> datos del área
    this.porCodigo = {};
    this.resaltados = []; // salones resaltados (uno o varios)
    this.separado = false;
    this.techoVisible = true;
    this.nivelActivo = "todos";
    this.raycaster = new THREE.Raycaster();

    this.actual = { theta: VISTAS.entrada.theta, phi: VISTAS.entrada.phi, radio: 80, objetivo: new THREE.Vector3(0, 4, 0) };
    this.deseado = { theta: VISTAS.entrada.theta, phi: VISTAS.entrada.phi, radio: 80, objetivo: new THREE.Vector3(0, 4, 0) };

    this._unirEventos();
    this._ajustarTamano();
    this.observador = new ResizeObserver(() => this._ajustarTamano());
    this.observador.observe(contenedor);

    this.reloj = new THREE.Clock();
    this._animar = this._animar.bind(this);
    requestAnimationFrame(this._animar);
  }

  /* ---------------- entorno: cielo, pasto y plaza ---------------- */

  _crearEntorno() {
    const HORIZONTE = 0xd6e9f7;
    this.escena.fog = new THREE.Fog(HORIZONTE, 170, 520);

    // Cielo: domo con degradado azul (más intenso arriba, claro en el horizonte).
    const cielo = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
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

    // Pasto: textura generada (manchas de varios verdes), repetida.
    const pasto = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200),
      new THREE.MeshStandardMaterial({ map: this._texturaPasto(), roughness: 1, metalness: 0 })
    );
    pasto.rotation.x = -Math.PI / 2;
    pasto.position.y = -0.1;
    pasto.receiveShadow = true;
    this.escena.add(pasto);

    // Plaza de adoquín hexagonal de cemento: 2.5 m alrededor del L3 (bloque
    // principal + bloque de baños + franja bajo la escalera de emergencia).
    // Contorno en coordenadas AutoCAD (X, Y), centro del dibujo en (1325.27, 2458.79).
    const CX = 1325.27, CY = 2458.79;
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

  /** Adoquín hexagonal de cemento gris (textura repetible). */
  _texturaHexagonal() {
    const R = 30;                       // radio del hexágono en píxeles
    const w = Math.sqrt(3) * R;         // ancho de un hexágono (punta arriba)
    const W = Math.round(2 * w);        // la textura abarca 2 columnas…
    const H = 6 * R;                    // …y 4 filas (se repite sin cortes)
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#6f7276";          // junta
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
          const r = R - 2.2;             // deja la junta visible
          ctx.lineTo(x + r * Math.cos(ang), y + r * Math.sin(ang));
        }
        ctx.closePath();
        ctx.fill();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const RADIO_M = 0.14;               // adoquín de ~25 cm de lado a lado
    t.repeat.set(1 / ((W / R) * RADIO_M), 1 / ((H / R) * RADIO_M));
    t.anisotropy = 8;
    return t;
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
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      ctx.fillRect(x, y, 1 + Math.random() * 2, 2 + Math.random() * 4);
    }
    ctx.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(180, 180);
    t.anisotropy = 8;
    return t;
  }

  /* ---------------- construcción ---------------- */

  cargar(modelo) {
    this.modelo = modelo;
    for (const nivel of modelo.niveles) {
      const grupo = new THREE.Group();
      grupo.userData.nivel = nivel.id;
      this.raiz.add(grupo);
      this.niveles.push({ ...nivel, grupo, offset: 0, offsetDeseado: 0 });
    }
    this.techo = new THREE.Group();
    this.raiz.add(this.techo);

    for (const obj of modelo.estructura) this._agregarEstructura(obj);
    for (const area of modelo.areas) this._agregarArea(area);

    // Letreros de salida de emergencia sobre cada puerta.
    for (const salida of modelo.salidas || []) {
      const letrero = this._crearEtiqueta("SALIDA DE EMERGENCIA", "salida");
      letrero.position.set(...salida.posicion);
      letrero.material.depthTest = true; // no se ve a través de los muros
      letrero.scale.multiplyScalar(0.8);
      this._contenedorDe(salida.nivel).add(letrero);
    }

    this.verEdificio(false);
  }

  /** Capa opcional de ventanas (data/fachada.json). No toca los muros. */
  cargarFachada(fachada) {
    const materiales = {
      // Translúcido, como la puerta de la entrada: detrás hay hueco en el muro.
      vidrio: { color: "#5d8aa8", metalness: 0.4, roughness: 0.08, transparent: true, opacity: 0.45, depthWrite: false },
      vidrio_torre: { color: "#5d8aa8", metalness: 0.4, roughness: 0.08, transparent: true, opacity: 0.45, depthWrite: false },
      marco: { color: "#8b939c", metalness: 0.55, roughness: 0.35 },
      persiana: { color: "#c3c8cd", metalness: 0.3, roughness: 0.5 },
    };
    this.fachada = [];
    for (const pieza of fachada.piezas || []) {
      if (!pieza.indices?.length) continue;
      const malla = new THREE.Mesh(
        this._geometria(pieza.vertices, pieza.indices),
        new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...(materiales[pieza.tipo] || materiales.marco) })
      );
      malla.userData.fachada = true;
      malla.castShadow = pieza.tipo !== "vidrio" && pieza.tipo !== "vidrio_torre";
      this._contenedorDe(pieza.nivel).add(malla);
      this.fachada.push(malla);
    }
  }

  /** Ventanas sí: vidrio + hueco abierto. Ventanas no: muro cerrado (tapas). */
  setVentanas(visible) {
    for (const malla of this.fachada || []) malla.visible = Boolean(visible);
    for (const tapa of this.tapas) tapa.visible = !visible;
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
    let color = COLORES_ESTRUCTURA[obj.tipo] || COLORES_ESTRUCTURA.otro;
    if (obj.tipo === "escalera" && obj.capa === "Escaleras de emergencia") color = "#d98b4a";
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.02,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    if (obj.tipo === "puerta_emergencia") {
      material.emissive = new THREE.Color("#1f9d55");
      material.emissiveIntensity = 0.45;
    }
    if (obj.tipo === "puerta_vidrio") {
      // Puerta principal de cristal, como el cancel de la entrada.
      material.color.set("#5d8aa8");
      material.metalness = 0.4;
      material.roughness = 0.08;
      material.transparent = true;
      material.opacity = 0.5;
      material.depthWrite = false;
    }
    if (obj.tipo === "barandal") {
      material.metalness = 0.25;
      material.roughness = 0.4;
    }
    const malla = new THREE.Mesh(geometria, material);
    if (obj.tipo === "tapa_ventana") this.tapas.push(malla);
    malla.castShadow = obj.tipo !== "losa";
    malla.receiveShadow = true;
    malla.userData = { tipo: obj.tipo, capa: obj.capa };
    const destino = this._contenedorDe(obj.nivel);
    destino.add(malla);

    if (["muro", "losa", "techo", "escalera", "columna"].includes(obj.tipo)) {
      let geoAristas = new THREE.EdgesGeometry(geometria, 25);
      if (obj.tipo === "columna") geoAristas = this._soloVerticales(geoAristas);
      const aristas = new THREE.LineSegments(
        geoAristas,
        new THREE.LineBasicMaterial({ color: 0x5b6470, transparent: true, opacity: 0.45 })
      );
      aristas.userData.esArista = true;
      destino.add(aristas);
    }
  }

  /** Deja solo las aristas verticales: las columnas se ven continuas entre pisos. */
  _soloVerticales(geoAristas) {
    const p = geoAristas.getAttribute("position").array;
    const salida = [];
    for (let i = 0; i < p.length; i += 6) {
      if (Math.abs(p[i + 1] - p[i + 4]) > 0.05) salida.push(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]);
    }
    geoAristas.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(salida, 3));
    return g;
  }

  _agregarArea(area) {
    const destino = this._contenedorDe(area.nivel);
    const color = COLORES_AREA[area.tipo] || COLORES_AREA.salon;

    // Piso coloreado (como en el plano 2D).
    const piso = new THREE.Mesh(
      this._geometria(area.piso.vertices, area.piso.indices),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide })
    );
    piso.receiveShadow = true;
    destino.add(piso);

    // Volumen invisible: sirve para hacer clic y para el resaltado.
    const geoVolumen = this._geometria(area.vertices, area.indices);
    const volumen = new THREE.Mesh(
      geoVolumen,
      new THREE.MeshStandardMaterial({
        color: DORADO,
        emissive: new THREE.Color(DORADO),
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
      new THREE.LineBasicMaterial({ color: DORADO, transparent: true, opacity: 1, depthTest: false })
    );
    contorno.visible = false;
    contorno.renderOrder = 6;
    contorno.userData.esContorno = true;
    destino.add(contorno);

    const texto = area.etiqueta || area.codigo || area.nombre;
    const etiqueta = this._crearEtiqueta(texto, area.codigo ? "salon" : area.tipo);
    etiqueta.position.set(area.centro[0], area.bbox[4] + 0.6, area.centro[2]);
    etiqueta.visible = false;
    destino.add(etiqueta);

    const datos = { ...area, piso, volumen, contorno, etiqueta, colorBase: color };
    this.areas[area.id] = datos;
    if (area.codigo) this.porCodigo[area.codigo] = datos;
  }

  _crearEtiqueta(texto, tipo) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const fuente = 44;
    ctx.font = `bold ${fuente}px Segoe UI, Arial`;
    const ancho = Math.min(900, Math.ceil(ctx.measureText(texto).width) + 48);
    canvas.width = ancho;
    canvas.height = 76;
    const esSalon = tipo === "salon";
    const esSalida = tipo === "salida";
    ctx.fillStyle = esSalida ? "#1f9d55" : esSalon ? "rgba(0, 43, 92, 0.94)" : "rgba(255, 255, 255, 0.92)";
    ctx.beginPath();
    ctx.roundRect(2, 2, ancho - 4, 72, 14);
    ctx.fill();
    ctx.strokeStyle = esSalida ? "#ffffff" : esSalon ? "#d4a72c" : "#002b5c";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = esSalon || esSalida ? "#ffffff" : "#002b5c";
    ctx.font = `bold ${fuente}px Segoe UI, Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(texto, ancho / 2, 40);

    const textura = new THREE.CanvasTexture(canvas);
    textura.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: textura, transparent: true, depthTest: false, depthWrite: false })
    );
    const alto = esSalon ? 1.3 : 0.9;
    sprite.scale.set((alto * ancho) / 76, alto, 1);
    sprite.renderOrder = 10;
    sprite.userData.base = sprite.scale.clone();
    return sprite;
  }

  /* ---------------- interacción ---------------- */

  _unirEventos() {
    const lienzo = this.renderer.domElement;
    lienzo.style.cursor = "grab";
    lienzo.style.touchAction = "none";
    let arrastre = null;

    lienzo.addEventListener("pointerdown", (e) => {
      const pan = e.button === 2 || e.button === 1 || e.shiftKey;
      arrastre = { pan, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY };
      lienzo.style.cursor = pan ? "move" : "grabbing";
      lienzo.setPointerCapture(e.pointerId);
    });

    lienzo.addEventListener("pointermove", (e) => {
      if (!arrastre) {
        lienzo.style.cursor = this._areaBajo(e) ? "pointer" : "grab";
        return;
      }
      const dx = e.clientX - arrastre.x;
      const dy = e.clientY - arrastre.y;
      arrastre.x = e.clientX;
      arrastre.y = e.clientY;
      if (arrastre.pan) {
        this._panear(dx, dy);
      } else {
        this.deseado.theta -= dx * 0.006;
        this.deseado.phi = THREE.MathUtils.clamp(this.deseado.phi - dy * 0.005, 0.15, 1.5);
        this.actual.theta = this.deseado.theta;
        this.actual.phi = this.deseado.phi;
      }
    });

    lienzo.addEventListener("pointerup", (e) => {
      if (arrastre && Math.hypot(e.clientX - arrastre.x0, e.clientY - arrastre.y0) < 5) {
        const area = this._areaBajo(e);
        if (area) {
          this.enfocarSalon(area.id);
          if (this.alSeleccionar) this.alSeleccionar(area);
        }
      }
      arrastre = null;
      lienzo.style.cursor = "grab";
    });

    lienzo.addEventListener("contextmenu", (e) => e.preventDefault());
    lienzo.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        // Con un piso seleccionado no se aleja más que la vista del piso.
        const maximo = this.nivelActivo === "todos" ? 220 : RADIO_NIVEL;
        this.deseado.radio = THREE.MathUtils.clamp(this.deseado.radio * Math.exp(e.deltaY * 0.001), 6, maximo);
      },
      { passive: false }
    );
    lienzo.addEventListener("dblclick", () => this.verEdificio());
  }

  _areaBajo(evento) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const puntero = new THREE.Vector2(
      ((evento.clientX - r.left) / r.width) * 2 - 1,
      -((evento.clientY - r.top) / r.height) * 2 + 1
    );
    this.raycaster.setFromCamera(puntero, this.camara);
    const candidatos = [];
    this.raiz.traverseVisible((o) => {
      if (!o.isMesh) return;
      if (o.material.userData?.fantasma) return;
      if (o.userData.fachada) return; // las ventanas no bloquean el clic
      candidatos.push(o);
    });
    for (const hit of this.raycaster.intersectObjects(candidatos, false)) {
      const id = hit.object.userData.areaId;
      if (id) return this.areas[id];
      // Un muro, losa o techo tapa lo que hay detrás.
      if (hit.object.material.opacity > 0.5) return null;
    }
    return null;
  }

  _panear(dx, dy) {
    const alto = this.renderer.domElement.clientHeight || 1;
    const factor = (2 * this.deseado.radio * Math.tan(THREE.MathUtils.degToRad(this.camara.fov / 2))) / alto;
    const derecha = new THREE.Vector3().setFromMatrixColumn(this.camara.matrixWorld, 0);
    const arriba = new THREE.Vector3().setFromMatrixColumn(this.camara.matrixWorld, 1);
    this.deseado.objetivo.addScaledVector(derecha, -dx * factor);
    this.deseado.objetivo.addScaledVector(arriba, dy * factor);
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

  _fantasma(grupo, activo) {
    grupo.traverse((o) => {
      if (!o.material || o.isSprite) return;
      const m = o.material;
      if (m.userData.opacidadBase === undefined) {
        m.userData.opacidadBase = m.opacity;
        m.userData.transparenteBase = m.transparent;
      }
      m.userData.fantasma = activo;
      if (o.userData.areaId || o.userData.esContorno) return; // siguen invisibles
      if (o.userData.sombraBase === undefined) o.userData.sombraBase = o.castShadow;
      o.castShadow = activo ? false : o.userData.sombraBase;
      m.transparent = activo ? true : m.userData.transparenteBase;
      m.opacity = activo ? 0.1 : m.userData.opacidadBase;
      m.depthWrite = !activo;
    });
  }

  _mostrarEtiquetas(nivelId) {
    for (const area of Object.values(this.areas)) {
      area.etiqueta.visible = nivelId !== "todos" && area.nivel === Number(nivelId);
    }
  }

  /** Muestra los pisos según el nivel activo (y si están separados). */
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
    this.techo.visible = activo === "todos" && this.techoVisible;
    this._mostrarEtiquetas(activo);
  }

  setTecho(visible) {
    this.techoVisible = Boolean(visible);
    this._actualizarVisibilidad();
  }

  /** Separa (o junta) los pisos verticalmente, como un despiece. */
  separar(activo) {
    this.separado = Boolean(activo);
    this._aplicarOffsets();
    this._actualizarVisibilidad();
    if (this.nivelActivo === "todos") {
      this.deseado.objetivo.y = this.separado ? 9 : 4;
      this.deseado.radio = this.separado ? 95 : 80;
    } else {
      this.deseado.objetivo.y = this._alturaPiso(this.nivelActivo) + 1.5;
    }
  }

  /* ---------------- cámara y resaltado ---------------- */

  /** Ángulo equivalente (±2π) más cercano al actual: así siempre gira por el lado corto. */
  _anguloCercano(theta) {
    const vuelta = Math.PI * 2;
    const actual = this.deseado.theta;
    return theta + Math.round((actual - theta) / vuelta) * vuelta;
  }

  vista(nombre) {
    const v = VISTAS[nombre] || VISTAS.entrada;
    this.limpiarResaltado();
    this.nivelActivo = "todos";
    this._actualizarVisibilidad();
    this.deseado.objetivo.set(0, this.separado ? 9 : 4, 0);
    this.deseado.radio = this.separado ? 95 : ["n", "s", "e", "o"].includes(nombre) ? 85 : 80;
    if (v.objetivo && !this.separado) {
      this.deseado.objetivo.set(...v.objetivo);
      this.deseado.radio = v.radio;
    }
    this.deseado.theta = this._anguloCercano(v.theta);
    this.deseado.phi = v.phi;
  }

  verEdificio(animar = true) {
    this.vista("entrada");
    if (!animar) {
      Object.assign(this.actual, { theta: this.deseado.theta, phi: this.deseado.phi, radio: this.deseado.radio });
      this.actual.objetivo.copy(this.deseado.objetivo);
    }
  }

  enfocarNivel(id, { conservarResaltado = false } = {}) {
    if (!this.niveles.some((n) => n.id === Number(id))) return;
    if (!conservarResaltado) this.limpiarResaltado();
    this.nivelActivo = Number(id);
    this._actualizarVisibilidad();
    this.deseado.objetivo.set(0, this._alturaPiso(id) + 1.5, 0);
    this.deseado.radio = RADIO_NIVEL;
    this.deseado.phi = 0.72;
  }

  enfocarSalon(codigoOId) {
    const area = this.porCodigo[codigoOId] || this.areas[codigoOId];
    if (!area) return false;
    this.enfocarNivel(area.nivel, { conservarResaltado: true });
    this.resaltar(area);
    const nivel = this.niveles.find((n) => n.id === area.nivel);
    this.deseado.objetivo.set(area.centro[0], area.centro[1] + nivel.offsetDeseado + 1.2, area.centro[2]);
    this.deseado.radio = 21;
    this.deseado.phi = 0.8;
    return true;
  }

  /**
   * Resalta varios salones a la vez (búsqueda por materia, clases ahora).
   * Si todos están en un piso, enfoca ese piso; si están en varios, separa
   * los pisos para que se vean todos. Devuelve cuántos encontró.
   */
  enfocarSalones(codigos) {
    const areas = [...new Set(codigos)].map((c) => this.porCodigo[c] || this.areas[c]).filter(Boolean);
    if (!areas.length) return 0;
    if (areas.length === 1) {
      this.enfocarSalon(areas[0].id);
      return 1;
    }
    const niveles = [...new Set(areas.map((a) => a.nivel))];
    if (niveles.length === 1) {
      this.enfocarNivel(niveles[0]);
    } else {
      this.limpiarResaltado();
      this.separado = true;
      this._aplicarOffsets();
      this.nivelActivo = "todos";
      this._actualizarVisibilidad();
      this.techo.visible = false; // para ver también el segundo piso
      const v = VISTAS.entrada;
      this.deseado.theta = this._anguloCercano(v.theta);
      this.deseado.phi = 1.0;
      this.deseado.radio = 82;
      this.deseado.objetivo.set(-4, 9, 0);
    }
    this.resaltar(areas, { etiquetasDelPiso: niveles.length === 1 });
    return areas.length;
  }

  resaltar(areas, { etiquetasDelPiso = true } = {}) {
    this.limpiarResaltado();
    const lista = Array.isArray(areas) ? areas : [areas];
    if (etiquetasDelPiso) {
      const niveles = new Set(lista.map((a) => a.nivel));
      for (const otra of Object.values(this.areas)) {
        if (niveles.has(otra.nivel)) otra.etiqueta.visible = true;
      }
    }
    for (const area of lista) {
      area.contorno.visible = true;
      area.piso.material.color.set(DORADO);
      area.piso.material.emissive = new THREE.Color(0x7a5400);
      area.etiqueta.material.color.set(0xffe08a);
      area.etiqueta.visible = true;
    }
    this.resaltados = lista;
  }

  limpiarResaltado() {
    for (const area of this.resaltados || []) {
      area.contorno.visible = false;
      area.volumen.material.opacity = 0;
      area.piso.material.color.set(area.colorBase);
      area.piso.material.emissive = new THREE.Color(0x000000);
      area.etiqueta.material.color.set(0xffffff);
      area.etiqueta.scale.copy(area.etiqueta.userData.base);
    }
    this.resaltados = [];
  }

  /* ---------------- ciclo ---------------- */

  _ajustarTamano() {
    const ancho = this.contenedor.clientWidth || 640;
    const alto = this.contenedor.clientHeight || 480;
    this.camara.aspect = ancho / alto;
    this.camara.updateProjectionMatrix();
    this.renderer.setSize(ancho, alto, false);
  }

  _animar() {
    requestAnimationFrame(this._animar);
    const s = 0.09;
    this.actual.theta += (this.deseado.theta - this.actual.theta) * s;
    this.actual.phi += (this.deseado.phi - this.actual.phi) * s;
    this.actual.radio += (this.deseado.radio - this.actual.radio) * s;
    this.actual.objetivo.lerp(this.deseado.objetivo, s);

    for (const n of this.niveles) {
      n.offset += (n.offsetDeseado - n.offset) * s;
      n.grupo.position.y = n.offset;
    }
    const superior = this.niveles[this.niveles.length - 1];
    if (superior) this.techo.position.y = superior.offset;

    const { theta, phi, radio, objetivo } = this.actual;
    this.camara.position.set(
      objetivo.x + radio * Math.sin(phi) * Math.sin(theta),
      objetivo.y + radio * Math.cos(phi),
      objetivo.z + radio * Math.sin(phi) * Math.cos(theta)
    );
    this.camara.lookAt(objetivo);

    if (this.resaltados.length) {
      const t = this.reloj.getElapsedTime() * 4;
      const pulso = 0.5 + 0.5 * Math.sin(t);
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
}
