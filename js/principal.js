// ============================================================
// MICE L3 · búsqueda, horarios, secciones y visor 3D
// ============================================================

const VERSION = "35";
const $ = (id) => document.getElementById(id);

const estado = {
  grupos: [],
  gruposOrdenados: [],
  materias: [],
  nombresProfesores: [],
  profesores: [],
  salones: {},
  areasPorId: {},
  secciones: { grupos: [], servicios: [] },
  semestre: "",
  modo: "grupo",
  seccion: "busqueda",
  indiceResaltado: -1,
  horaElegida: null,
  visor: null,
  techoVisible: true,
  separado: false,
  ventanas: null,
};

const SECCIONES = {
  busqueda: { titulo: "Buscar" },
  grupos: { titulo: "Grupos estudiantiles", filtro: "Filtrar grupos, ej. IDEA", vacio: "grupos estudiantiles" },
  servicios: { titulo: "Servicios para alumnos", filtro: "Filtrar servicios, ej. MAKER", vacio: "servicios para alumnos" },
};

const PLACEHOLDER_MODO = {
  grupo: "Número de grupo, ej. 8419",
  maestro: "Nombre del profesor, ej. GARCIA",
  materia: "Materia o clave, ej. DISEÑO LOGICO",
};

const NOMBRE_TIPO = {
  salon: "Salón de clases",
  apoyo: "Área de gestión de apoyo",
  grupo: "Grupo estudiantil",
  servicio: "Servicio para alumnos",
  restringido: "Solo personal autorizado",
  bano: "Sanitarios",
};

const NOMBRE_VISTA = {
  entrada: "Vista desde la entrada · poniente",
  n: "Vista norte",
  s: "Vista sur",
  e: "Vista este",
  o: "Vista oeste",
  ne: "Isométrica noreste",
  no: "Isométrica noroeste",
  se: "Isométrica sureste",
  so: "Isométrica suroeste",
};

const TEXTO_INICIO = "Vista desde la entrada · elige un piso o haz clic en un salón";
const AYUDA_MAPA = "Arrastra para girar · clic derecho, botón central o Shift+arrastrar para mover · rueda para acercar";
const FOTO_GENERICA = "img/profesor_generico.png";
const SIN_BUSQUEDA = "<p class='placeholder'>Aún no hay búsqueda.</p>";

// ---------- utilidades ----------

function escapar(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Texto sin acentos, en mayúsculas y sin signos (para comparar). */
function plano(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Todas las palabras de la búsqueda aparecen en el texto, en cualquier orden. */
function coincidePalabras(texto, busqueda) {
  const objetivo = plano(texto);
  const palabras = plano(busqueda).split(" ").filter(Boolean);
  return palabras.length > 0 && palabras.every((p) => objetivo.includes(p));
}

/** "08419", "84-19" -> "8419". */
function limpiarGrupo(texto) {
  return String(texto ?? "").replace(/\D/g, "").replace(/^0+(?=\d{3})/, "");
}

/** Distancia de edición entre dos palabras. */
function distancia(a, b) {
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previo = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = temp;
    }
  }
  return fila[b.length];
}

/** Opciones más parecidas a la búsqueda ("¿Quisiste decir…?"). */
function masParecidos(busqueda, opciones, cuantos = 4) {
  const q = plano(busqueda).split(" ").filter(Boolean);
  if (!q.length) return [];
  return opciones
    .map((op) => {
      const palabras = plano(op).split(" ");
      const d = Math.min(...q.map((w) => Math.min(...palabras.map((p) => distancia(w, p.slice(0, w.length + 1))))));
      return { op, d };
    })
    .filter((x) => x.d <= 2)
    .sort((a, b) => a.d - b.d)
    .slice(0, cuantos)
    .map((x) => x.op);
}

async function cargarJSON(ruta) {
  const respuesta = await fetch(ruta, { cache: "no-cache" });
  if (!respuesta.ok) throw new Error(`${ruta}: HTTP ${respuesta.status}`);
  return respuesta.json();
}

function nivelDeSalon(codigo) {
  const m = /^L3(\d)/.exec(codigo || "");
  return m ? Number(m[1]) : null;
}

/** "L30022" -> "L30022 · IASE" si el salón tiene un segundo nombre. */
function nombreSalon(codigo) {
  const area = estado.salones[codigo];
  if (!area) return codigo || "";
  const otro = area.alias || (area.nombre !== area.codigo ? area.nombre : null);
  return otro ? `${codigo} · ${otro}` : codigo;
}

function nombreNivel(id) {
  return ["Planta baja", "Primer piso", "Segundo piso"][id] ?? "Nivel";
}

function estadoMapa(texto) {
  $("mapaEstado").textContent = texto;
}

// ---------- horarios ----------

const DIAS = ["DOM", "LUN", "MAR", "MIE", "JUE", "VIE", "SAB"];
const DIAS_LARGO = { DOM: "Domingo", LUN: "Lunes", MAR: "Martes", MIE: "Miércoles", JUE: "Jueves", VIE: "Viernes", SAB: "Sábado" };
const INICIO_DIA = 7 * 60;
const FIN_DIA = 24 * 60;
const sesionesPorDia = new Map();

function aMinutos(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
}

function rango(hora) {
  const [a, b] = String(hora || "").split("-");
  return b ? [aMinutos(a), aMinutos(b)] : null;
}

function formatoHora(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function horarioTexto(grupo) {
  return (grupo.sesiones || []).map((s) => `${s.dia} ${s.hora}`).join(" · ");
}

/** Sesiones de un día [{grupo, inicio, fin}], calculadas una sola vez por día. */
function sesionesDelDia(dia) {
  if (!sesionesPorDia.has(dia)) {
    const salida = [];
    for (const g of estado.grupos) {
      for (const s of g.sesiones || []) {
        const r = s.dia === dia ? rango(s.hora) : null;
        if (r) salida.push({ grupo: g, inicio: r[0], fin: r[1] });
      }
    }
    salida.sort((a, b) => a.inicio - b.inicio || a.grupo.salon.localeCompare(b.grupo.salon));
    sesionesPorDia.set(dia, salida);
  }
  return sesionesPorDia.get(dia);
}

function enCursoA(sesiones, minutos) {
  return sesiones.filter((s) => s.inicio <= minutos && minutos < s.fin);
}

function ahora() {
  const d = new Date();
  return { dia: DIAS[d.getDay()], minutos: d.getHours() * 60 + d.getMinutes() };
}

/** Hora consultada: la elegida en la línea del tiempo o la actual. */
function minutosConsulta() {
  return estado.horaElegida ?? ahora().minutos;
}

// ---------- arranque ----------

document.addEventListener("DOMContentLoaded", iniciar);

async function iniciar() {
  conectarInterfaz();

  // Datos y visor 3D se piden en paralelo.
  const [horarios, profesores, secciones, modelo, fachada, modulo3D] = await Promise.allSettled([
    cargarJSON("data/horarios.json"),
    cargarJSON("data/profesores.json"),
    cargarJSON("data/secciones.json"),
    cargarJSON("data/edificio.json"),
    cargarJSON("data/fachada.json"),
    import(`./escena3d.js?v=${VERSION}`),
  ]);

  if (horarios.status === "rejected") {
    mostrarErrorCarga(horarios.reason);
    return;
  }

  estado.grupos = horarios.value.grupos || [];
  estado.semestre = horarios.value.meta?.semestre || "";
  estado.gruposOrdenados = [...estado.grupos].sort((a, b) => Number(a.grupo) - Number(b.grupo));
  const ordenar = (lista) => [...new Set(lista.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  estado.materias = ordenar(estado.grupos.map((g) => g.materia));
  estado.nombresProfesores = ordenar(estado.grupos.map((g) => g.profesor));
  if (profesores.status === "fulfilled") estado.profesores = profesores.value.profesores || [];
  if (secciones.status === "fulfilled") {
    estado.secciones = { grupos: secciones.value.grupos || [], servicios: secciones.value.servicios || [] };
  }

  iniciarLineaTiempo();

  if (modelo.status === "fulfilled") {
    const areas = modelo.value.areas || [];
    estado.areasPorId = Object.fromEntries(areas.map((a) => [a.id, a]));
    estado.salones = Object.fromEntries(areas.filter((a) => a.codigo).map((a) => [a.codigo, a]));
    if (modulo3D.status === "fulfilled") {
      iniciarVisor(modulo3D.value.VisorEdificio, modelo.value, fachada.status === "fulfilled" ? fachada.value : null);
    } else {
      avisoVisor("No se pudo cargar el visor 3D. Revisa tu conexión (Three.js se carga desde internet).");
    }
  } else {
    avisoVisor("Modelo 3D no disponible. Genera data/edificio.json con scripts/generar_modelo.py.");
  }

  aplicarParametrosDeEnlace();
}

function conectarInterfaz() {
  const input = $("searchInput");

  document.querySelectorAll(".modoBtn").forEach((btn) => btn.addEventListener("click", () => cambiarModo(btn.dataset.modo)));
  $("searchBtn").addEventListener("click", buscar);
  input.addEventListener("input", alEscribir);
  input.addEventListener("focus", alEscribir);
  input.addEventListener("click", alEscribir);
  input.addEventListener("keydown", alPresionarTecla);

  $("autocompletado").addEventListener("click", (e) => {
    const opcion = e.target.closest(".opcionAuto");
    if (opcion) elegirOpcion(opcion.dataset.valor);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".input-wrap")) ocultarAutocompletado();
    if (!e.target.closest(".lt-hora-wrap")) ocultarOpcionesHora();
  });

  $("result").addEventListener("click", (e) => {
    const sugerencia = e.target.closest("[data-sugerencia]");
    const grupo = e.target.closest("[data-grupo]");
    if (sugerencia) {
      cambiarModo(sugerencia.dataset.sugerencia);
      elegirOpcion(sugerencia.dataset.valor);
    } else if (grupo) {
      cambiarModo("grupo");
      elegirOpcion(grupo.dataset.grupo);
    }
  });

  $("ahoraBtn").addEventListener("click", mostrarClasesDeLaLinea);
  conectarLineaTiempo();

  document.querySelectorAll(".seccionBtn").forEach((btn) => btn.addEventListener("click", () => cambiarSeccion(btn.dataset.seccion)));
  $("filtroSeccion").addEventListener("input", renderListaSeccion);
  $("listaSeccion").addEventListener("click", (e) => {
    const tarjeta = e.target.closest("[data-area]");
    if (tarjeta) mostrarDetalleSeccion(tarjeta.dataset.area);
  });
  $("limpiarBtn").addEventListener("click", limpiarBusqueda);

  document.querySelectorAll(".nivelBtn[data-nivel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!estado.visor) return;
      const nivel = btn.dataset.nivel;
      if (nivel === "todos") {
        estado.visor.verEdificio();
        marcarNivelActivo("todos");
        marcarVistaActiva("entrada");
        estadoMapa(TEXTO_INICIO);
      } else {
        estado.visor.enfocarNivel(nivel);
        marcarNivelActivo(nivel);
        marcarVistaActiva(null);
        estadoMapa(textoNivel(Number(nivel)));
      }
    });
  });

  $("plano2dBtn").addEventListener("click", () => {
    if (!estado.visor) return;
    estado.visor.set2D(!estado.visor.modo2D);
    estado.separado = estado.visor.separado;
    actualizarBotonesVisor();
    marcarNivelActivo(String(estado.visor.nivelActivo));
    marcarVistaActiva(null);
    estadoMapa(textoNivel(Number(estado.visor.nivelActivo)));
  });

  $("separarBtn").addEventListener("click", () => {
    if (!estado.visor) return;
    estado.visor.set2D(false);
    estado.separado = !estado.separado;
    estado.visor.separar(estado.separado);
    actualizarBotonesVisor();
  });

  $("ventanasBtn").addEventListener("click", () => {
    if (!estado.visor || estado.ventanas === null) return;
    estado.ventanas = !estado.ventanas;
    estado.visor.setVentanas(estado.ventanas);
    actualizarBotonesVisor();
  });

  $("techoBtn").addEventListener("click", () => {
    if (!estado.visor) return;
    estado.techoVisible = !estado.techoVisible;
    estado.visor.setTecho(estado.techoVisible);
    actualizarBotonesVisor();
  });

  document.querySelectorAll(".vistaBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!estado.visor) return;
      estado.visor.vista(btn.dataset.vista);
      marcarVistaActiva(btn.dataset.vista);
      marcarNivelActivo("todos");
      estadoMapa(`${NOMBRE_VISTA[btn.dataset.vista] || "Vista del edificio"} · clic derecho para mover`);
    });
  });
}

function textoNivel(nivel) {
  return estado.visor?.modo2D
    ? `Plano 2D · ${nombreNivel(nivel)} · arrastra para mover · rueda para acercar`
    : `${nombreNivel(nivel)} · haz clic en un salón`;
}

// ---------- enlaces directos (?grupo=, ?maestro=, ?materia=, ?ahora, ?nivel=, ?vista=) ----------

function aplicarParametrosDeEnlace() {
  const p = new URLSearchParams(window.location.search);
  for (const modo of ["grupo", "maestro", "materia"]) {
    if (p.get(modo)) {
      cambiarModo(modo);
      $("searchInput").value = p.get(modo);
      buscar();
      return;
    }
  }
  if (p.has("ahora")) {
    clasesAhora();
    return;
  }
  if (!estado.visor) return;
  const nivel = p.get("nivel");
  if (nivel && nivel !== "todos") {
    estado.visor.enfocarNivel(nivel);
    marcarNivelActivo(nivel);
    estadoMapa(textoNivel(Number(nivel)));
  } else if (p.get("vista")) {
    estado.visor.vista(p.get("vista"));
    marcarVistaActiva(p.get("vista"));
  }
}

// ---------- modos de búsqueda ----------

function cambiarModo(modo) {
  estado.modo = modo;
  document.querySelectorAll(".modoBtn").forEach((btn) => {
    const activo = btn.dataset.modo === modo;
    btn.classList.toggle("activo", activo);
    btn.setAttribute("aria-selected", String(activo));
  });
  const input = $("searchInput");
  input.value = "";
  input.placeholder = PLACEHOLDER_MODO[modo];
  ocultarAutocompletado();
  $("result").innerHTML = SIN_BUSQUEDA;
  actualizarFotoProfesor(null);
  input.focus();
}

// ---------- autocompletado ----------

function alEscribir() {
  const texto = $("searchInput").value;
  estado.indiceResaltado = -1;
  if (estado.modo === "grupo") mostrarGrupos(texto);
  else if (estado.modo === "materia") mostrarMaterias(texto);
  else mostrarProfesores(texto);
}

function mostrarProfesores(texto) {
  const lista = plano(texto)
    ? estado.nombresProfesores.filter((n) => coincidePalabras(n, texto))
    : estado.nombresProfesores;
  mostrarAutocompletado(lista.map((n) => ({ valor: n, texto: n })));
}

/** Materias que coinciden por nombre o por clave. */
function filtrarMaterias(texto) {
  const q = plano(texto);
  if (!q) return estado.materias;
  const porClave = new Set(estado.grupos.filter((g) => g.clave === q).map((g) => g.materia));
  return estado.materias.filter((m) => porClave.has(m) || coincidePalabras(m, texto));
}

function mostrarMaterias(texto) {
  mostrarAutocompletado(filtrarMaterias(texto).map((m) => ({ valor: m, texto: m })));
}

function mostrarGrupos(texto) {
  const digitos = limpiarGrupo(texto);
  const grupos = estado.gruposOrdenados
    .filter((g) => !digitos || g.grupo.startsWith(digitos))
    .map((g) => ({ valor: g.grupo, texto: g.grupo, detalle: `${g.materia} · ${nombreSalon(g.salon)}` }));
  mostrarAutocompletado(grupos, true);
}

function mostrarAutocompletado(items, deGrupos = false) {
  const lista = $("autocompletado");
  if (!items.length) {
    ocultarAutocompletado();
    return;
  }
  const fragmento = document.createDocumentFragment();
  for (const item of items) {
    const opcion = document.createElement("div");
    opcion.className = "opcionAuto";
    opcion.setAttribute("role", "option");
    opcion.dataset.valor = item.valor;
    opcion.textContent = item.texto;
    if (item.detalle) opcion.title = item.detalle;
    fragmento.appendChild(opcion);
  }
  lista.replaceChildren(fragmento);
  lista.classList.toggle("grupos", deGrupos);
  lista.classList.add("visible");
}

function ocultarAutocompletado() {
  const lista = $("autocompletado");
  lista.classList.remove("visible", "grupos");
  lista.replaceChildren();
}

function elegirOpcion(valor) {
  $("searchInput").value = valor;
  ocultarAutocompletado();
  buscar();
}

function alPresionarTecla(e) {
  const opciones = $("autocompletado").querySelectorAll(".opcionAuto");
  if (e.key === "Escape") {
    ocultarAutocompletado();
    $("searchInput").blur();
    return;
  }
  if (opciones.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    const paso = e.key === "ArrowDown" ? 1 : -1;
    estado.indiceResaltado = Math.min(Math.max(estado.indiceResaltado + paso, 0), opciones.length - 1);
    opciones.forEach((o, i) => o.classList.toggle("resaltada", i === estado.indiceResaltado));
    opciones[estado.indiceResaltado].scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const opcion = opciones[estado.indiceResaltado];
    if (opcion) elegirOpcion(opcion.dataset.valor);
    else {
      ocultarAutocompletado();
      buscar();
    }
  }
}

// ---------- búsqueda ----------

function buscar() {
  if (!estado.grupos.length) return;
  if (estado.modo === "grupo") buscarPorGrupo();
  else if (estado.modo === "materia") buscarPorMateria();
  else buscarPorMaestro();
}

/** Botones "¿Quisiste decir…?". */
function sugerencias(modo, opciones) {
  if (!opciones.length) return "";
  const botones = opciones
    .map((op) => `<button type="button" class="sugerencia" data-sugerencia="${escapar(modo)}" data-valor="${escapar(op)}">${escapar(op)}</button>`)
    .join("");
  return `<p class="sugerencia-titulo">¿Quisiste decir…?</p><div class="sugerencia-lista">${botones}</div>`;
}

function sinResultados(mensaje, htmlSugerencias = "") {
  $("result").innerHTML = `<p class='placeholder'>${mensaje}</p>${htmlSugerencias}`;
  actualizarFotoProfesor(null);
  if (estado.visor) {
    estado.visor.limpiarResaltado();
    estadoMapa(AYUDA_MAPA);
  }
}

function buscarPorGrupo() {
  const texto = limpiarGrupo($("searchInput").value);
  if (!texto) {
    $("result").innerHTML = "<p class='placeholder'>Escribe un número de grupo.</p>";
    return;
  }
  const grupo = estado.grupos.find((g) => g.grupo === texto);
  if (!grupo) {
    let parecidos = estado.gruposOrdenados.filter((g) => g.grupo.startsWith(texto));
    if (!parecidos.length) {
      parecidos = [...estado.gruposOrdenados].sort(
        (a, b) => Math.abs(a.grupo - texto) - Math.abs(b.grupo - texto)
      );
    }
    sinResultados(`No se encontró el grupo ${escapar(texto)}.`, sugerencias("grupo", parecidos.slice(0, 6).map((g) => g.grupo)));
    return;
  }
  $("searchInput").value = grupo.grupo;
  renderizarGrupo(grupo);
  actualizarFotoProfesor(grupo.profesor);
  ubicarSalon(grupo.salon);
}

function buscarPorMateria() {
  const texto = $("searchInput").value;
  if (!plano(texto)) {
    mostrarMaterias("");
    $("result").innerHTML = "<p class='placeholder'>Elige una materia de la lista.</p>";
    return;
  }
  const exacta = estado.materias.find((m) => plano(m) === plano(texto));
  const candidatas = exacta ? [exacta] : filtrarMaterias(texto);
  if (candidatas.length !== 1) {
    sinResultados(
      candidatas.length
        ? `Hay ${candidatas.length} materias que coinciden con “${escapar(texto)}”.`
        : `No se encontró la materia “${escapar(texto)}”.`,
      sugerencias("materia", (candidatas.length ? candidatas : masParecidos(texto, estado.materias, 5)).slice(0, 8))
    );
    return;
  }

  const materia = candidatas[0];
  $("searchInput").value = materia;
  const grupos = estado.gruposOrdenados.filter((g) => g.materia === materia);
  const porProfesor = new Map();
  for (const g of grupos) {
    if (!porProfesor.has(g.profesor)) porProfesor.set(g.profesor, []);
    porProfesor.get(g.profesor).push(g);
  }
  const salones = [...new Set(grupos.map((g) => g.salon))].sort();
  const bloques = [...porProfesor.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "es"))
    .map(([profesor, lista]) => `
      <section class="materia-profesor">
        <h3>${escapar(profesor)} <span>${lista.length} grupo${lista.length === 1 ? "" : "s"}</span></h3>
        <div class="clase-lista">${lista.map((g) => tarjetaClase(g)).join("")}</div>
      </section>`)
    .join("");

  $("result").innerHTML = `
    <div class="ficha-grupo"><span class="ficha-materia ficha-materia-grande">${escapar(materia)}</span></div>
    <p><strong>${grupos.length}</strong> grupo(s) · <strong>${porProfesor.size}</strong> profesor(es) · clave ${escapar(grupos[0]?.clave || "—")}</p>
    <p class="salones-chips">${salones.map((s) => `<span class="clase-salon">${escapar(nombreSalon(s))}</span>`).join(" ")}</p>
    ${bloques}`;

  actualizarFotoProfesor(porProfesor.size === 1 ? grupos[0].profesor : null, porProfesor.size > 1);
  ubicarSalones(salones, `${materia} · ${salones.length} salón(es)`);
}

function buscarPorMaestro() {
  const texto = $("searchInput").value;
  if (!plano(texto)) {
    $("result").innerHTML = "<p class='placeholder'>Escribe o elige un nombre de profesor.</p>";
    return;
  }
  const clases = estado.gruposOrdenados.filter((g) => coincidePalabras(g.profesor, texto));
  if (!clases.length) {
    sinResultados(
      `No se encontraron clases para “${escapar(texto)}”.`,
      sugerencias("maestro", masParecidos(texto, estado.nombresProfesores, 5))
    );
    return;
  }
  $("result").innerHTML = `
    <p><strong>${clases.length}</strong> clase(s) encontrada(s) para “${escapar(texto)}”.</p>
    <div class="clase-lista">${clases.map((c) => tarjetaClase(c)).join("")}</div>`;

  const nombres = [...new Set(clases.map((c) => c.profesor))];
  actualizarFotoProfesor(nombres.length === 1 ? nombres[0] : null, nombres.length > 1);
  if (nombres.length === 1) {
    const salones = [...new Set(clases.map((c) => c.salon))];
    ubicarSalones(salones, `${nombres[0]} · ${salones.length} salón(es)`);
  }
}

/** Tarjeta de una clase. */
function tarjetaClase(clase, extra = "", etiqueta = nombreSalon(clase.salon), meta = `${clase.profesor} · ${horarioTexto(clase) || "Horario pendiente"}`) {
  return `
    <article class="clase-card">
      <div class="clase-head">
        <button type="button" class="clase-grupo" data-grupo="${escapar(clase.grupo)}">${escapar(clase.grupo)}</button>
        <span class="clase-salon">${escapar(etiqueta)}</span>
      </div>
      <p class="clase-materia">${escapar(clase.materia)}</p>
      <p class="clase-meta">${escapar(meta)}${extra}</p>
    </article>`;
}

/** "Hoy", "En curso" o "Terminó" para una sesión de hoy. */
function estadoSesion(s) {
  const { dia, minutos } = ahora();
  const r = rango(s.hora);
  if (s.dia !== dia || !r) return "";
  if (minutos < r[0]) return `<span class="estado-sesion prox">Hoy</span>`;
  if (minutos < r[1]) return `<span class="estado-sesion curso">En curso</span>`;
  return `<span class="estado-sesion fin">Terminó</span>`;
}

function renderizarGrupo(grupo) {
  const sesiones = (grupo.sesiones || [])
    .map((s) => `<li>${escapar(DIAS_LARGO[s.dia] || s.dia)} · ${escapar(s.hora)} ${estadoSesion(s)}</li>`)
    .join("");
  const aviso = estado.salones[grupo.salon]
    ? ""
    : `<p class="aviso">Este salón no aparece en el modelo 3D. Revisa que exista
       un sólido con su nombre en el DXF y vuelve a ejecutar generar_modelo.py.</p>`;
  $("result").innerHTML = `
    <div class="ficha-grupo">
      <span class="grupo-codigo">${escapar(grupo.grupo)}</span>
      <span class="ficha-materia">${escapar(grupo.materia)}</span>
    </div>
    <dl class="ficha-grid">
      <dt>Clave</dt><dd>${escapar(grupo.clave)}</dd>
      <dt>Profesor</dt><dd>${escapar(grupo.profesor)}</dd>
      <dt>Salón</dt><dd>${escapar(nombreSalon(grupo.salon))}</dd>
      <dt>Tipo</dt><dd>${escapar(grupo.tipo || "—")}${grupo.cupo ? ` · Cupo ${escapar(grupo.cupo)}` : ""}</dd>
    </dl>
    <ul class="sesion-lista">${sesiones || "<li>Horario pendiente</li>"}</ul>
    ${aviso}`;
}

// ---------- secciones: Grupos Estudiantiles / Servicios para Alumnos ----------

function cambiarSeccion(seccion) {
  estado.seccion = seccion;
  document.querySelectorAll(".seccionBtn").forEach((btn) => {
    const activo = btn.dataset.seccion === seccion;
    btn.classList.toggle("activo", activo);
    btn.setAttribute("aria-selected", String(activo));
  });
  $("tituloBusqueda").textContent = SECCIONES[seccion].titulo;
  $("seccionBusqueda").hidden = seccion !== "busqueda";
  $("seccionLista").hidden = seccion === "busqueda";
  ocultarAutocompletado();
  actualizarFotoProfesor(null);

  if (seccion === "busqueda") {
    limpiarMapa();
    return;
  }
  $("filtroSeccion").value = "";
  $("filtroSeccion").placeholder = SECCIONES[seccion].filtro;
  $("detalleSeccion").hidden = true;
  renderListaSeccion();

  const ids = estado.secciones[seccion].map((item) => item.area).filter((id) => estado.areasPorId[id]);
  if (ids.length) ubicarSalones(ids, `${SECCIONES[seccion].titulo} · ${ids.length} lugar(es)`);
}

function datosLugar(item) {
  const area = estado.areasPorId[item.area];
  return {
    area,
    piso: area ? area.ubicacion || nombreNivel(area.nivel) : "Ubicación pendiente",
    salon: area?.codigo ? `Salón ${area.codigo}` : "",
  };
}

function renderListaSeccion() {
  const seccion = estado.seccion;
  if (seccion === "busqueda") return;
  const todos = estado.secciones[seccion];
  const filtro = $("filtroSeccion").value;
  const items = plano(filtro)
    ? todos.filter((item) => coincidePalabras(`${item.nombre} ${item.area} ${item.descripcion || ""}`, filtro))
    : todos;

  if (!todos.length) {
    $("listaSeccion").innerHTML = `<p class="placeholder">Aún no hay ${SECCIONES[seccion].vacio} registrados.</p>`;
  } else if (!items.length) {
    $("listaSeccion").innerHTML = `<p class="placeholder">Nada coincide con “${escapar(filtro)}”.</p>`;
  } else {
    $("listaSeccion").innerHTML = items
      .map((item) => {
        const { piso, salon } = datosLugar(item);
        return `
          <button type="button" class="clase-card seccion-card" data-area="${escapar(item.area)}">
            <span class="clase-head">
              <span class="seccion-nombre">${escapar(item.nombre)}</span>
              ${salon ? `<span class="clase-salon">${escapar(salon)}</span>` : ""}
            </span>
            <span class="clase-meta">${escapar(piso)}</span>
            <span class="clase-meta">${escapar(item.descripcion || "Información pendiente")}</span>
          </button>`;
      })
      .join("");
  }
}

function mostrarDetalleSeccion(id) {
  const item = estado.secciones[estado.seccion].find((x) => x.area === id);
  if (!item) return;
  const { area, piso, salon } = datosLugar(item);
  const campos = [
    ["Responsable", item.responsable],
    ["Contacto", item.contacto],
    ["Horario", item.horario],
    ["Redes", item.redes],
  ].filter(([, valor]) => valor);

  $("detalleSeccion").hidden = false;
  $("detalleSeccion").innerHTML = `
    <div class="ficha-grupo"><span class="ficha-materia ficha-materia-grande">${escapar(item.nombre)}</span></div>
    <p>${escapar([salon, piso].filter(Boolean).join(" · "))}</p>
    ${item.descripcion ? `<p>${escapar(item.descripcion)}</p>` : `<p class="placeholder">Información pendiente: se agregará próximamente.</p>`}
    ${campos.length ? `<dl class="ficha-grid">${campos.map(([k, v]) => `<dt>${k}</dt><dd>${escapar(v)}</dd>`).join("")}</dl>` : ""}`;
  document.querySelectorAll(".seccion-card").forEach((c) => c.classList.toggle("activa", c.dataset.area === id));
  if (area && estado.visor) {
    estado.visor.enfocarSalon(area.id);
    marcarNivelActivo(String(area.nivel));
    marcarVistaActiva(null);
    estadoMapa(`${item.nombre} · ${piso}`);
  }
}

/** Mapa a la vista inicial, sin resaltados ni pisos separados. */
function limpiarMapa() {
  if (!estado.visor) return;
  if (estado.separado) {
    estado.separado = false;
    estado.visor.separar(false);
  }
  estado.visor.verEdificio();
  actualizarBotonesVisor();
  marcarNivelActivo("todos");
  marcarVistaActiva("entrada");
  estadoMapa(TEXTO_INICIO);
}

function limpiarBusqueda() {
  if (estado.seccion !== "busqueda") {
    $("filtroSeccion").value = "";
    $("detalleSeccion").hidden = true;
    renderListaSeccion();
    limpiarMapa();
    $("filtroSeccion").focus();
    return;
  }
  $("searchInput").value = "";
  ocultarAutocompletado();
  $("result").innerHTML = SIN_BUSQUEDA;
  actualizarFotoProfesor(null);
  limpiarMapa();
  if (window.location.search) history.replaceState(null, "", window.location.pathname);
  $("searchInput").focus();
}

// ---------- clases a una hora ----------

function clasesAhora() {
  if (!estado.grupos.length) return;
  ocultarAutocompletado();
  const { dia } = ahora();
  const minutos = minutosConsulta();
  const elegida = estado.horaElegida !== null;
  const hoy = sesionesDelDia(dia);
  const enCurso = enCursoA(hoy, minutos);
  const siguienteInicio = hoy.find((s) => s.inicio > minutos)?.inicio;
  const siguientes = siguienteInicio === undefined ? [] : hoy.filter((s) => s.inicio === siguienteInicio);
  const aEsaHora = elegida ? "a esa hora" : "en curso";

  const tarjetas = (lista, conFin) =>
    lista
      .map((s) => tarjetaClase(s.grupo, ` · <strong>${conFin ? `termina ${formatoHora(s.fin)}` : `empieza ${formatoHora(s.inicio)}`}</strong>`))
      .join("");

  let html = `<div class="ficha-grupo"><span class="ficha-materia ficha-materia-grande">${
    elegida ? `Clases a las ${formatoHora(minutos)}` : "Clases en este momento"
  }</span></div>
    <p>${escapar(DIAS_LARGO[dia])} · ${formatoHora(minutos)}${elegida ? " (hora elegida)" : ""}</p>`;
  if (!hoy.length) {
    html += `<p class="placeholder">Hoy no hay clases registradas en el L3.</p>`;
  } else if (enCurso.length) {
    html += `<p><strong>${enCurso.length}</strong> clase(s) ${aEsaHora}.</p><div class="clase-lista">${tarjetas(enCurso, true)}</div>`;
  } else {
    html += `<p class="placeholder">No hay clases ${elegida ? "a esa hora" : "en este momento"}.</p>`;
  }
  if (siguientes.length) {
    html += `<p class="sugerencia-titulo">Siguientes, a las ${formatoHora(siguienteInicio)}</p>
      <div class="clase-lista">${tarjetas(siguientes, false)}</div>`;
  }
  $("result").innerHTML = html;
  actualizarFotoProfesor(null, enCurso.length > 1);

  const resaltar = (enCurso.length ? enCurso : siguientes).map((s) => s.grupo.salon);
  if (resaltar.length) {
    ubicarSalones(
      resaltar,
      enCurso.length
        ? `${enCurso.length} clase(s) ${elegida ? `a las ${formatoHora(minutos)}` : "en curso"}`
        : `Siguientes clases · ${formatoHora(siguienteInicio)}`
    );
  } else {
    estado.visor?.limpiarResaltado();
  }
}

// ---------- línea del tiempo (encabezado) ----------

function posicionEnLinea(minutos) {
  return Math.min(Math.max((minutos - INICIO_DIA) / (FIN_DIA - INICIO_DIA), 0), 1) * 100;
}

function iniciarLineaTiempo() {
  const pista = $("ltPista");
  const fragmento = document.createDocumentFragment();

  // Marcas de hora (número cada 2 h).
  for (let h = 7; h <= 24; h++) {
    const marca = document.createElement("span");
    const mayor = (h - 7) % 2 === 0;
    marca.className = mayor ? "lt-tick lt-tick-mayor" : "lt-tick";
    marca.style.left = `${posicionEnLinea(h * 60)}%`;
    if (mayor || h === 24) marca.dataset.hora = String(h);
    fragmento.appendChild(marca);
  }

  // Barras de cuántas clases hay cada media hora.
  const hoy = sesionesDelDia(ahora().dia);
  const conteo = [];
  for (let t = INICIO_DIA; t < FIN_DIA; t += 30) conteo.push(enCursoA(hoy, t + 15).length);
  const maximo = Math.max(1, ...conteo);
  conteo.forEach((n, i) => {
    if (!n) return;
    const inicio = INICIO_DIA + i * 30;
    const barra = document.createElement("span");
    barra.className = "lt-barra";
    barra.style.left = `${posicionEnLinea(inicio)}%`;
    barra.style.width = `${posicionEnLinea(inicio + 30) - posicionEnLinea(inicio)}%`;
    barra.style.height = `${20 + 80 * (n / maximo)}%`;
    barra.title = `${formatoHora(inicio)} · ${n} clase(s)`;
    fragmento.appendChild(barra);
  });
  pista.appendChild(fragmento);

  actualizarLineaTiempo();
  setInterval(actualizarLineaTiempo, 30000);
}

function actualizarLineaTiempo() {
  const { dia, minutos: actual } = ahora();
  const elegida = estado.horaElegida !== null;
  const minutos = elegida ? estado.horaElegida : actual;
  const dentro = minutos >= INICIO_DIA && minutos <= FIN_DIA;
  $("ltMarca").style.left = `${posicionEnLinea(minutos)}%`;
  $("ltMarca").classList.toggle("fuera", !dentro);
  $("ltPasado").style.width = `${posicionEnLinea(actual)}%`;
  $("ltAhora").style.left = `${posicionEnLinea(actual)}%`;
  $("ltAhora").hidden = !elegida;
  $("ltHora").textContent = `${DIAS_LARGO[dia]} · ${formatoHora(minutos)}${elegida ? " (hora elegida)" : ""}`;
  $("ltHoraInput").placeholder = formatoHora(actual);
  const n = enCursoA(sesionesDelDia(dia), minutos).length;
  $("ltEstado").textContent = dentro ? `${n} clase(s) ${elegida ? "a esa hora" : "en curso"}` : "Fuera del horario del L3";
}

function elegirHora(minutos, mostrar = false) {
  estado.horaElegida = Math.min(Math.max(Math.round(minutos / 5) * 5, INICIO_DIA), FIN_DIA - 5);
  $("ltHoraInput").value = formatoHora(estado.horaElegida);
  $("ahoraBtn").textContent = "Clases a esa hora";
  $("ltResetBtn").hidden = false;
  actualizarLineaTiempo();
  if (mostrar) mostrarClasesDeLaLinea();
}

function volverAhora(mostrar = false) {
  estado.horaElegida = null;
  $("ltHoraInput").value = "";
  $("ahoraBtn").textContent = "Clases en este momento";
  $("ltResetBtn").hidden = true;
  actualizarLineaTiempo();
  if (mostrar) mostrarClasesDeLaLinea();
}

function mostrarClasesDeLaLinea() {
  if (estado.seccion !== "busqueda") cambiarSeccion("busqueda");
  clasesAhora();
}

/** Lista con las horas en que empiezan clases hoy (o en la semana, si hoy no hay). */
function mostrarOpcionesHora() {
  const { dia, minutos } = ahora();
  let sesiones = sesionesDelDia(dia);
  let nota = "Horarios de hoy";
  if (!sesiones.length) {
    sesiones = ["LUN", "MAR", "MIE", "JUE", "VIE", "SAB"].flatMap(sesionesDelDia);
    nota = "Hoy no hay clases · horarios de la semana";
  }
  const conteo = new Map();
  for (const s of sesiones) conteo.set(s.inicio, (conteo.get(s.inicio) || 0) + 1);
  const opciones = [...conteo.keys()]
    .sort((a, b) => a - b)
    .map((m) => {
      const n = conteo.get(m);
      const clases = `lt-opcion${m === estado.horaElegida ? " activa" : ""}${m < minutos ? " pasada" : ""}`;
      return `<button type="button" class="${clases}" data-minutos="${m}">
        <span>${formatoHora(m)}</span><span class="lt-opcion-n">${n} clase${n === 1 ? "" : "s"}</span>
      </button>`;
    })
    .join("");
  $("ltOpciones").innerHTML = `
    <p class="lt-opciones-titulo">${nota}</p>
    <button type="button" class="lt-opcion lt-opcion-ahora" data-minutos="ahora">Ahora · ${formatoHora(minutos)}</button>
    ${opciones}`;
  $("ltOpciones").hidden = false;
}

function ocultarOpcionesHora() {
  $("ltOpciones").hidden = true;
}

function conectarLineaTiempo() {
  const pista = $("ltPista");
  const minutosEn = (e) => {
    const r = pista.getBoundingClientRect();
    return INICIO_DIA + Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * (FIN_DIA - INICIO_DIA);
  };

  // Arrastrar el marcador o hacer clic en la línea.
  let arrastrando = false;
  pista.addEventListener("pointerdown", (e) => {
    arrastrando = true;
    pista.classList.add("arrastrando");
    pista.setPointerCapture(e.pointerId);
    elegirHora(minutosEn(e));
  });
  pista.addEventListener("pointermove", (e) => {
    if (arrastrando) elegirHora(minutosEn(e));
  });
  const soltar = () => {
    if (!arrastrando) return;
    arrastrando = false;
    pista.classList.remove("arrastrando");
    mostrarClasesDeLaLinea();
  };
  pista.addEventListener("pointerup", soltar);
  pista.addEventListener("pointercancel", soltar);

  // Cuadro de hora: se escribe HH:MM / HHMM o se elige de la lista.
  const cuadro = $("ltHoraInput");
  const aplicarCuadro = () => {
    const valor = cuadro.value.trim();
    if (!valor) {
      if (estado.horaElegida !== null) volverAhora(true);
      return;
    }
    const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(valor);
    if (!m || Number(m[1]) > 23 || Number(m[2] || 0) > 59) {
      cuadro.classList.add("error");
      return;
    }
    cuadro.classList.remove("error");
    ocultarOpcionesHora();
    elegirHora(Number(m[1]) * 60 + Number(m[2] || 0), true);
  };
  cuadro.addEventListener("focus", mostrarOpcionesHora);
  cuadro.addEventListener("click", mostrarOpcionesHora);
  cuadro.addEventListener("input", () => cuadro.classList.remove("error"));
  cuadro.addEventListener("change", aplicarCuadro);
  cuadro.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      aplicarCuadro();
      cuadro.blur();
    } else if (e.key === "Escape") {
      ocultarOpcionesHora();
      cuadro.blur();
    }
  });
  $("ltOpciones").addEventListener("click", (e) => {
    const opcion = e.target.closest("[data-minutos]");
    if (!opcion) return;
    ocultarOpcionesHora();
    if (opcion.dataset.minutos === "ahora") volverAhora(true);
    else elegirHora(Number(opcion.dataset.minutos), true);
  });
  $("ltResetBtn").addEventListener("click", () => volverAhora(true));
}

// ---------- panel del profesor ----------

function actualizarFotoProfesor(nombre, varios = false) {
  const foto = $("fotoProfesor");
  const correo = $("correoProfesor");
  correo.classList.remove("visible");
  correo.replaceChildren();

  if (!nombre) {
    foto.src = FOTO_GENERICA;
    foto.alt = varios ? "Varios profesores" : "Foto del profesor";
    $("nombreProfesorFoto").textContent = varios ? "Varios maestros" : "Selecciona un maestro";
    return;
  }

  const profesor = estado.profesores.find((p) => p.nombre === nombre);
  foto.onerror = () => {
    foto.onerror = null;
    foto.src = FOTO_GENERICA;
  };
  foto.src = profesor?.foto || FOTO_GENERICA;
  foto.alt = `Foto de ${nombre}`;
  $("nombreProfesorFoto").textContent = nombre;

  if (profesor?.correo) {
    // Corte de línea permitido solo después de la @.
    const [usuario, dominio] = profesor.correo.split("@");
    correo.append(dominio ? `${usuario}@` : usuario);
    if (dominio) correo.append(document.createElement("wbr"), dominio);
    correo.classList.add("visible");
  }
}

// ---------- visor 3D ----------

function iniciarVisor(VisorEdificio, modelo, fachada) {
  estado.visor = new VisorEdificio($("visor3d"));
  estado.visor.cargar(modelo);
  estado.visor.alSeleccionar = mostrarArea;
  estado.visor.alCambiar2D = actualizarBotonesVisor;
  if (fachada) {
    estado.visor.cargarFachada(fachada);
    estado.ventanas = true;
  } else {
    $("ventanasBtn").hidden = true;
  }
  estado.visor.setVentanas(Boolean(fachada));
  if (new URLSearchParams(window.location.search).has("depurar")) window.miceVisor = estado.visor;

  $("visorEstado")?.remove();
  actualizarBotonesVisor();
  marcarNivelActivo("todos");
  marcarVistaActiva("entrada");
  estadoMapa(TEXTO_INICIO);
}

function ubicarSalon(codigo) {
  if (!estado.visor || !codigo) return;
  const nivel = nivelDeSalon(codigo) ?? estado.areasPorId[codigo]?.nivel ?? null;
  if (estado.visor.enfocarSalon(codigo)) {
    marcarNivelActivo(String(nivel));
    marcarVistaActiva(null);
    estadoMapa(`Salón ${codigo} · ${nombreNivel(nivel)}`);
  } else if (nivel !== null) {
    estado.visor.enfocarNivel(nivel);
    marcarNivelActivo(String(nivel));
    estadoMapa(`Salón ${codigo} no está en el modelo · ${nombreNivel(nivel)}`);
  } else {
    estado.visor.verEdificio();
    marcarNivelActivo("todos");
  }
}

/** Ilumina varios salones (códigos L30010 o ids de área como "Grupo IDEA"). */
function ubicarSalones(codigos, mensaje) {
  if (!estado.visor) return;
  const areaDe = (c) => estado.salones[c] || estado.areasPorId[c];
  const unicos = [...new Set(codigos)].filter(areaDe);
  if (unicos.length <= 1) {
    if (unicos.length) ubicarSalon(unicos[0]);
    return;
  }
  estado.visor.enfocarSalones(unicos);
  estado.separado = estado.visor.separado;
  actualizarBotonesVisor();
  const niveles = [...new Set(unicos.map((c) => areaDe(c).nivel))];
  marcarNivelActivo(niveles.length === 1 ? String(niveles[0]) : "todos");
  marcarVistaActiva(null);
  estadoMapa(niveles.length === 1
    ? `${mensaje} · ${nombreNivel(niveles[0])}`
    : `${mensaje} · ${niveles.length} pisos (pisos separados)`);
}

function marcarNivelActivo(nivel) {
  document.querySelectorAll(".nivelBtn[data-nivel]").forEach((btn) => btn.classList.toggle("activo", btn.dataset.nivel === String(nivel)));
}

function marcarVistaActiva(vista) {
  document.querySelectorAll(".vistaBtn").forEach((btn) => btn.classList.toggle("activo", btn.dataset.vista === String(vista)));
}

function actualizarBotonesVisor() {
  const alternar = (id, activo, texto) => {
    const btn = $(id);
    btn.textContent = texto;
    btn.classList.toggle("activo", activo);
  };
  const modo2D = Boolean(estado.visor?.modo2D);
  alternar("plano2dBtn", modo2D, modo2D ? "Vista 3D" : "Plano 2D");
  alternar("techoBtn", estado.techoVisible, estado.techoVisible ? "Techo: sí" : "Techo: no");
  alternar("separarBtn", estado.separado, estado.separado ? "Juntar pisos" : "Separar pisos");
  if (estado.ventanas !== null) alternar("ventanasBtn", estado.ventanas, estado.ventanas ? "Ventanas: sí" : "Ventanas: no");
}

/** Ficha del área al hacer clic en el modelo 3D. */
function mostrarArea(area) {
  marcarNivelActivo(String(area.nivel));
  marcarVistaActiva(null);
  estadoMapa(area.tipo === "bano"
    ? `${area.nombre} · descanso de la escalera`
    : `${area.codigo || area.nombre} · ${nombreNivel(area.nivel)}`);
  actualizarFotoProfesor(null);

  const titulo = [area.codigo, area.nombre !== area.codigo ? area.nombre : null, area.alias].filter(Boolean).join(" · ");
  const subtitulo = area.descripcion || `${NOMBRE_TIPO[area.tipo] || ""} · ${area.ubicacion || nombreNivel(area.nivel)}`;
  const grupos = area.codigo ? estado.gruposOrdenados.filter((g) => g.salon === area.codigo) : [];
  const lista = grupos.map((g) => tarjetaClase(g, "", horarioTexto(g) || "Horario pendiente", g.profesor)).join("");

  let cuerpo = "";
  if (area.tipo !== "bano") {
    cuerpo = grupos.length
      ? `<p><strong>${grupos.length}</strong> grupo(s) en este salón${estado.semestre ? ` (semestre ${escapar(estado.semestre)})` : ""}.</p>
         <div class="clase-lista">${lista}</div>`
      : `<p class="placeholder">No hay grupos registrados en esta área.</p>`;
  }
  $("result").innerHTML = `
    <div class="ficha-grupo">
      <span class="grupo-codigo">${escapar(titulo)}</span>
      <span class="ficha-materia">${escapar(subtitulo)}</span>
    </div>
    ${area.descripcion && area.ubicacion ? `<p class="placeholder">${escapar(area.ubicacion)}.</p>` : ""}
    ${cuerpo}`;
}

// ---------- errores ----------

function avisoVisor(texto) {
  const aviso = $("visorEstado");
  if (!aviso) return;
  aviso.textContent = texto;
  aviso.classList.add("error");
}

function mostrarErrorCarga(error) {
  console.error(error);
  $("result").innerHTML = `
    <p class="aviso">
      No se pudieron cargar los datos (${escapar(error?.message)}).
      Abre el proyecto con un servidor local, por ejemplo
      <code>python -m http.server 8000</code>, y visita <code>http://localhost:8000</code>.
    </p>`;
  avisoVisor("Modelo 3D no disponible.");
}
