// ============================================================
// MICE L3 · lógica de búsqueda, datos y visor 3D
// ============================================================

const $ = (id) => document.getElementById(id);

const estado = {
  grupos: [],
  gruposOrdenados: [],
  profesores: [],
  salones: {},
  modelo: null,
  semestre: "",
  modo: "grupo",
  indiceResaltado: -1,
  visor: null,
  techoVisible: true,
  separado: false,
  seccion: "busqueda", // busqueda | grupos | servicios
  secciones: { grupos: [], servicios: [] },
  areasPorId: {},
};

const SECCIONES = {
  busqueda: { titulo: "Buscar" },
  grupos: { titulo: "Grupos estudiantiles", filtro: "Filtrar grupos, ej. IDEA", vacio: "grupos estudiantiles" },
  servicios: { titulo: "Servicios para alumnos", filtro: "Filtrar servicios, ej. MAKER", vacio: "servicios para alumnos" },
};

const AYUDA_MAPA = "Arrastra para girar · clic derecho, botón central o Shift+arrastrar para mover · rueda para acercar";

// ---------- utilidades ----------

function escapar(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizar(texto) {
  return String(texto ?? "").trim().toUpperCase();
}

/** Para comparar sin importar acentos, mayúsculas ni espacios de más. */
function plano(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Todas las palabras de la búsqueda aparecen en el texto (en cualquier orden). */
function coincidePalabras(texto, busqueda) {
  const objetivo = plano(texto);
  const palabras = plano(busqueda).split(" ").filter(Boolean);
  return palabras.length > 0 && palabras.every((p) => objetivo.includes(p));
}

/** "08419", "84-19", " 8419 " -> "8419". */
function limpiarGrupo(texto) {
  return String(texto ?? "").replace(/\D/g, "").replace(/^0+(?=\d{3})/, "");
}

/** Distancia de edición (para sugerir el nombre más parecido). */
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

/** Las opciones más parecidas a la búsqueda (para "¿Quisiste decir…?"). */
function masParecidos(busqueda, opciones, cuantos = 4) {
  const q = plano(busqueda);
  if (!q) return [];
  return opciones
    .map((op) => {
      const palabras = plano(op).split(" ");
      const mejor = Math.min(...q.split(" ").map((w) => Math.min(...palabras.map((p) => distancia(w, p.slice(0, w.length + 1))))));
      return { op, d: mejor };
    })
    .filter((x) => x.d <= 2)
    .sort((a, b) => a.d - b.d)
    .slice(0, cuantos)
    .map((x) => x.op);
}

// ---------- horario de hoy ----------

const DIAS = ["DOM", "LUN", "MAR", "MIE", "JUE", "VIE", "SAB"];
const DIAS_LARGO = { DOM: "Domingo", LUN: "Lunes", MAR: "Martes", MIE: "Miércoles", JUE: "Jueves", VIE: "Viernes", SAB: "Sábado" };
const INICIO_DIA = 7 * 60;   // 7:00
const FIN_DIA = 24 * 60;     // 24:00

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

/** Sesiones de un día: [{grupo, inicio, fin}] */
function sesionesDelDia(dia) {
  const salida = [];
  for (const g of estado.grupos) {
    for (const s of g.sesiones || []) {
      const r = s.dia === dia ? rango(s.hora) : null;
      if (r) salida.push({ grupo: g, inicio: r[0], fin: r[1] });
    }
  }
  return salida.sort((a, b) => a.inicio - b.inicio || a.grupo.salon.localeCompare(b.grupo.salon));
}

function ahora() {
  const d = new Date();
  return { dia: DIAS[d.getDay()], minutos: d.getHours() * 60 + d.getMinutes() };
}

async function cargarJSON(ruta) {
  const respuesta = await fetch(ruta, { cache: "no-store" });
  if (!respuesta.ok) throw new Error(`${ruta}: HTTP ${respuesta.status}`);
  return respuesta.json();
}

function nivelDeSalon(codigo) {
  const coincidencia = /^L3(\d)/.exec(codigo || "");
  return coincidencia ? Number(coincidencia[1]) : null;
}

/** "L30022" -> "L30022 · IASE" cuando el salón tiene un segundo nombre. */
function nombreSalon(codigo) {
  const area = estado.salones[codigo];
  if (!area) return codigo || "";
  const otro = area.alias || (area.nombre !== area.codigo ? area.nombre : null);
  return otro ? `${codigo} · ${otro}` : codigo;
}

function nombreNivel(id) {
  return ["Planta baja", "Primer piso", "Segundo piso"][id] ?? "Nivel";
}

// ---------- arranque ----------

document.addEventListener("DOMContentLoaded", iniciar);

async function iniciar() {
  conectarInterfaz();

  try {
    const [horarios, profesores] = await Promise.all([
      cargarJSON("data/horarios.json"),
      cargarJSON("data/profesores.json"),
    ]);

    estado.grupos = Array.isArray(horarios.grupos) ? horarios.grupos : [];
    estado.gruposOrdenados = [...estado.grupos].sort(
      (a, b) => Number(a.grupo) - Number(b.grupo) || a.grupo.localeCompare(b.grupo)
    );
    estado.profesores = Array.isArray(profesores.profesores) ? profesores.profesores : [];
    estado.materias = [...new Set(estado.grupos.map((g) => g.materia).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "es")
    );
    estado.nombresProfesores = [...new Set(estado.grupos.map((g) => g.profesor).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "es")
    );
    estado.semestre = horarios.meta?.semestre || "";
    $("notaMapeo")?.setAttribute("hidden", "");

    // Información de grupos estudiantiles y servicios (opcional).
    try {
      const secciones = await cargarJSON("data/secciones.json");
      estado.secciones = { grupos: secciones.grupos || [], servicios: secciones.servicios || [] };
    } catch (errorSecciones) {
      console.warn("Sin data/secciones.json:", errorSecciones);
    }

    // El modelo 3D es opcional: si falta, la búsqueda sigue funcionando.
    try {
      estado.modelo = await cargarJSON("data/edificio.json");
      estado.areasPorId = Object.fromEntries((estado.modelo.areas || []).map((a) => [a.id, a]));
      const areas = (estado.modelo.areas || []).filter((area) => area.codigo);
      estado.salones = Object.fromEntries(areas.map((area) => [area.codigo, area]));
    } catch (errorModelo) {
      console.warn("Modelo 3D no disponible:", errorModelo);
      estado.modelo = null;
      estado.salones = {};
    }


    console.log(
      `MICE L3: ${estado.grupos.length} grupos, ${estado.profesores.length} profesores, ` +
        `${estado.modelo?.niveles?.length || 0} niveles, ${estado.modelo?.areas?.length || 0} áreas, ` +
        `${Object.keys(estado.salones).length} salones con código.`
    );

    iniciarLineaTiempo();
    if (estado.modelo) await iniciarVisor();
    else marcarModeloNoDisponible();
    aplicarParametrosDeEnlace();
  } catch (error) {
    console.error(error);
    mostrarErrorCarga(error);
  }
}

function conectarInterfaz() {
  const input = $("searchInput");
  const boton = $("searchBtn");

  document.querySelectorAll(".modoBtn").forEach((btn) => {
    btn.addEventListener("click", () => cambiarModo(btn.dataset.modo));
  });

  boton.addEventListener("click", buscar);
  input.addEventListener("input", alEscribir);
  input.addEventListener("focus", alEnfocar);
  input.addEventListener("click", alEnfocar);
  input.addEventListener("keydown", alPresionarTecla);

  document.addEventListener("click", (evento) => {
    if (!evento.target.closest(".input-wrap")) ocultarAutocompletado();
  });

  $("result").addEventListener("click", (evento) => {
    const sugerencia = evento.target.closest("[data-sugerencia]");
    if (sugerencia) {
      cambiarModo(sugerencia.dataset.sugerencia);
      input.value = sugerencia.dataset.valor;
      ocultarAutocompletado();
      buscar();
      return;
    }
    const enlace = evento.target.closest("[data-grupo]");
    if (!enlace) return;
    cambiarModo("grupo");
    input.value = enlace.dataset.grupo;
    buscar();
  });

  $("ahoraBtn")?.addEventListener("click", () => {
    if (estado.seccion !== "busqueda") cambiarSeccion("busqueda");
    clasesAhora();
  });

  document.querySelectorAll(".seccionBtn").forEach((btn) => {
    btn.addEventListener("click", () => cambiarSeccion(btn.dataset.seccion));
  });
  $("filtroSeccion")?.addEventListener("input", renderListaSeccion);
  $("listaSeccion")?.addEventListener("click", (evento) => {
    const tarjeta = evento.target.closest("[data-area]");
    if (tarjeta) mostrarDetalleSeccion(tarjeta.dataset.area);
  });
  $("limpiarBtn")?.addEventListener("click", limpiarBusqueda);

  document.querySelectorAll(".nivelBtn[data-nivel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!estado.visor) return;
      const nivel = btn.dataset.nivel;
      if (nivel === "todos") {
        estado.visor.verEdificio();
        marcarNivelActivo("todos");
        marcarVistaActiva("entrada");
        $("mapaEstado").textContent = "Vista desde la entrada · clic derecho para mover";
      } else {
        estado.visor.enfocarNivel(nivel);
        marcarNivelActivo(nivel);
        marcarVistaActiva(null);
        $("mapaEstado").textContent = `${nombreNivel(Number(nivel))} · haz clic en un salón`;
      }
    });
  });

  $("separarBtn")?.addEventListener("click", () => {
    if (!estado.visor) return;
    estado.separado = !estado.separado;
    estado.visor.separar(estado.separado);
    actualizarBotonesVisor();
  });

  $("ventanasBtn")?.addEventListener("click", () => {
    if (!estado.visor || estado.ventanas === null) return;
    estado.ventanas = !estado.ventanas;
    estado.visor.setVentanas(estado.ventanas);
    actualizarBotonesVisor();
  });

  $("techoBtn")?.addEventListener("click", () => {
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
      $("mapaEstado").textContent = etiquetaVista(btn.dataset.vista);
    });
  });
}

// ---------- enlaces directos ----------

function aplicarParametrosDeEnlace() {
  const parametros = new URLSearchParams(window.location.search);
  const grupo = parametros.get("grupo");
  const maestro = parametros.get("maestro");
  const nivel = parametros.get("nivel");
  const vista = parametros.get("vista");

  if (grupo) {
    cambiarModo("grupo");
    $("searchInput").value = grupo;
    buscar();
  } else if (maestro) {
    cambiarModo("maestro");
    $("searchInput").value = maestro;
    buscar();
  } else if (parametros.get("materia")) {
    cambiarModo("materia");
    $("searchInput").value = parametros.get("materia");
    buscar();
  } else if (parametros.get("ahora") !== null) {
    clasesAhora();
  }

  if (!grupo && !maestro && !parametros.get("materia") && parametros.get("ahora") === null && estado.visor) {
    if (nivel !== null && nivel !== "") {
      if (nivel === "todos") {
        estado.visor.verEdificio();
        marcarNivelActivo("todos");
      } else {
        estado.visor.enfocarNivel(nivel);
        marcarNivelActivo(nivel);
        $("mapaEstado").textContent = nombreNivel(Number(nivel));
      }
    } else if (vista) {
      estado.visor.vista(vista);
      marcarVistaActiva(vista);
      $("mapaEstado").textContent = etiquetaVista(vista);
    }
  }
}

// ---------- modos ----------

function cambiarModo(modo) {
  estado.modo = modo;
  document.querySelectorAll(".modoBtn").forEach((btn) => {
    const activo = btn.dataset.modo === modo;
    btn.classList.toggle("activo", activo);
    btn.setAttribute("aria-selected", String(activo));
  });

  const input = $("searchInput");
  input.value = "";
  ocultarAutocompletado();
  $("result").innerHTML = "<p class='placeholder'>Aún no hay búsqueda.</p>";
  input.placeholder = {
    grupo: "Número de grupo, ej. 8419",
    maestro: "Nombre del profesor, ej. GARCIA",
    materia: "Materia o clave, ej. DISEÑO LOGICO",
  }[modo];
  actualizarFotoProfesor(null);
  input.focus();
}

// ---------- autocompletado ----------

function alEscribir() {
  const texto = $("searchInput").value;
  estado.indiceResaltado = -1;

  if (estado.modo === "grupo") {
    mostrarGrupos(texto);
    return;
  }
  if (estado.modo === "materia") {
    mostrarMaterias(texto);
    return;
  }

  mostrarProfesores(texto);
}

/** Sin texto: todos los profesores; con texto: los que coinciden. */
function mostrarProfesores(texto) {
  const lista = plano(texto)
    ? estado.nombresProfesores.filter((nombre) => coincidePalabras(nombre, texto))
    : estado.nombresProfesores;
  mostrarAutocompletado(lista, "maestros");
}

function alEnfocar() {
  const texto = $("searchInput").value;
  if (estado.modo === "grupo") {
    mostrarGrupos(texto);
  } else if (estado.modo === "materia") {
    mostrarMaterias(texto); // al hacer clic se despliegan todas las materias
  } else {
    mostrarProfesores(texto); // al hacer clic se despliegan todos los profesores
  }
}

/** Materias que coinciden con el texto (por nombre o por clave). */
function filtrarMaterias(texto) {
  const q = plano(texto);
  if (!q) return estado.materias;
  const porClave = new Set(estado.grupos.filter((g) => g.clave === q).map((g) => g.materia));
  return estado.materias.filter((m) => porClave.has(m) || coincidePalabras(m, texto));
}

function mostrarMaterias(texto) {
  const items = filtrarMaterias(texto).map((materia) => ({ valor: materia, texto: materia }));
  mostrarAutocompletado(items, "materias");
}

function mostrarGrupos(texto) {
  const digitos = limpiarGrupo(texto);
  const grupos = estado.gruposOrdenados
    .filter((grupo) => !digitos || grupo.grupo.startsWith(digitos))
    .map((grupo) => ({
      valor: grupo.grupo,
      texto: grupo.grupo,
      detalle: `${grupo.materia} · ${nombreSalon(grupo.salon)}`,
    }));
  mostrarAutocompletado(grupos, "grupos");
}

function mostrarAutocompletado(items, tipo = "maestros") {
  const lista = $("autocompletado");
  if (!items.length) {
    ocultarAutocompletado();
    return;
  }

  const normalizados = items.map((item) =>
    typeof item === "string" ? { valor: item, texto: item } : item
  );
  const limite = normalizados.length; // la lista tiene scroll

  lista.innerHTML = "";
  lista.classList.toggle("grupos", tipo === "grupos");

  normalizados.slice(0, limite).forEach((item) => {
    const opcion = document.createElement("div");
    opcion.className = "opcionAuto";
    opcion.setAttribute("role", "option");
    opcion.dataset.valor = item.valor;
    opcion.textContent = item.texto;
    if (item.extra) {
      const extra = document.createElement("span");
      extra.className = "opcion-extra";
      extra.textContent = item.extra;
      opcion.appendChild(extra);
    }
    if (item.detalle) opcion.title = item.detalle;
    opcion.addEventListener("click", () => {
      $("searchInput").value = item.valor;
      ocultarAutocompletado();
      buscar();
    });
    lista.appendChild(opcion);
  });

  lista.classList.add("visible");
}

function ocultarAutocompletado() {
  const lista = $("autocompletado");
  lista.classList.remove("visible");
  lista.classList.remove("grupos");
  lista.innerHTML = "";
}

function alPresionarTecla(evento) {
  const lista = $("autocompletado");
  const opciones = lista.querySelectorAll(".opcionAuto");
  const visible = lista.classList.contains("visible");

  if (evento.key === "Escape") {
    ocultarAutocompletado();
    $("searchInput").blur();
    return;
  }

  if (visible && opciones.length) {
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      estado.indiceResaltado = Math.min(estado.indiceResaltado + 1, opciones.length - 1);
      resaltarOpcion(opciones);
      return;
    }
    if (evento.key === "ArrowUp") {
      evento.preventDefault();
      estado.indiceResaltado = Math.max(estado.indiceResaltado - 1, 0);
      resaltarOpcion(opciones);
      return;
    }
    if (evento.key === "Enter" && estado.indiceResaltado >= 0) {
      evento.preventDefault();
      const opcion = opciones[estado.indiceResaltado];
      $("searchInput").value = opcion.dataset.valor;
      ocultarAutocompletado();
      buscar();
      return;
    }
  }

  if (evento.key === "Enter") {
    ocultarAutocompletado();
    buscar();
  }
}

function resaltarOpcion(opciones) {
  opciones.forEach((opcion, indice) => {
    opcion.classList.toggle("resaltada", indice === estado.indiceResaltado);
  });
  const actual = opciones[estado.indiceResaltado];
  if (actual) actual.scrollIntoView({ block: "nearest" });
}

// ---------- búsqueda ----------

function buscar() {
  if (!estado.grupos.length) return;
  if (estado.modo === "grupo") buscarPorGrupo();
  else if (estado.modo === "materia") buscarPorMateria();
  else buscarPorMaestro();
}

/** Botones "¿Quisiste decir…?" (los atiende el clic del panel de resultados). */
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
    $("mapaEstado").textContent = AYUDA_MAPA;
  }
}

function buscarPorGrupo() {
  const original = $("searchInput").value;
  const texto = limpiarGrupo(original);

  if (!texto) {
    $("result").innerHTML = "<p class='placeholder'>Escribe un número de grupo.</p>";
    return;
  }

  const grupo = estado.grupos.find((g) => g.grupo === texto);
  if (!grupo) {
    // Sugerencias: los que empiezan igual y, si no, los números más cercanos.
    let parecidos = estado.gruposOrdenados.filter((g) => g.grupo.startsWith(texto)).map((g) => g.grupo);
    if (!parecidos.length) {
      parecidos = [...estado.gruposOrdenados]
        .sort((a, b) => Math.abs(Number(a.grupo) - Number(texto)) - Math.abs(Number(b.grupo) - Number(texto)))
        .map((g) => g.grupo);
    }
    sinResultados(`No se encontró el grupo ${escapar(texto)}.`, sugerencias("grupo", [...new Set(parecidos)].slice(0, 6)));
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
    const opciones = candidatas.length ? candidatas : masParecidos(texto, estado.materias, 5);
    sinResultados(
      candidatas.length ? `Hay ${candidatas.length} materias que coinciden con “${escapar(texto)}”.` : `No se encontró la materia “${escapar(texto)}”.`,
      sugerencias("materia", opciones.slice(0, 8))
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
        <div class="clase-lista">${lista.map(tarjetaClase).join("")}</div>
      </section>`)
    .join("");

  $("result").innerHTML = `
    <div class="ficha-grupo">
      <span class="ficha-materia ficha-materia-grande">${escapar(materia)}</span>
    </div>
    <p><strong>${grupos.length}</strong> grupo(s) · <strong>${porProfesor.size}</strong> profesor(es) · clave ${escapar(grupos[0]?.clave || "—")}</p>
    <p class="salones-chips">${salones.map((s) => `<span class="clase-salon">${escapar(nombreSalon(s))}</span>`).join(" ")}</p>
    ${bloques}
  `;

  actualizarFotoProfesor(porProfesor.size === 1 ? grupos[0].profesor : null, porProfesor.size > 1);
  ubicarSalones(salones, `${materia} · ${salones.length} salón(es)`);
}

/** Tarjeta de una clase (se usa en maestro, materia y clases ahora). */
function tarjetaClase(clase, extra = "") {
  const horario = (clase.sesiones || []).map((s) => `${s.dia} ${s.hora}`).join(" · ");
  return `
    <article class="clase-card">
      <div class="clase-head">
        <button type="button" class="clase-grupo" data-grupo="${escapar(clase.grupo)}">${escapar(clase.grupo)}</button>
        <span class="clase-salon">${escapar(nombreSalon(clase.salon))}</span>
      </div>
      <p class="clase-materia">${escapar(clase.materia)}</p>
      <p class="clase-meta">${escapar(clase.profesor)} · ${escapar(horario || "Horario pendiente")}${extra}</p>
    </article>`;
}

/** "En curso", "Hoy a las 19:00" o "Terminó" para una sesión de hoy. */
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

  const profesor = escapar(grupo.profesor);
  const mapeado = Boolean(estado.salones[grupo.salon]);
  const aviso = mapeado
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
      <dt>Profesor</dt><dd>${profesor}</dd>
      <dt>Salón</dt><dd>${escapar(nombreSalon(grupo.salon))}</dd>
      <dt>Tipo</dt><dd>${escapar(grupo.tipo || "—")}${grupo.cupo ? ` · Cupo ${escapar(grupo.cupo)}` : ""}</dd>
    </dl>
    <ul class="sesion-lista">${sesiones || "<li>Horario pendiente</li>"}</ul>
    ${aviso}
  `;
}

function buscarPorMaestro() {
  const texto = $("searchInput").value;
  if (!plano(texto)) {
    $("result").innerHTML = "<p class='placeholder'>Escribe o elige un nombre de maestro.</p>";
    return;
  }

  // Tolerante: sin acentos y con las palabras en cualquier orden ("juan villanueva").
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
    <div class="clase-lista">${clases.map((c) => tarjetaClase(c)).join("")}</div>
  `;

  const nombres = [...new Set(clases.map((c) => c.profesor))];
  actualizarFotoProfesor(nombres.length === 1 ? nombres[0] : null, nombres.length > 1);

  const salones = [...new Set(clases.map((c) => c.salon))];
  if (nombres.length === 1) ubicarSalones(salones, `${nombres[0]} · ${salones.length} salón(es)`);
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

  // Al entrar a la sección se iluminan todos sus lugares en el mapa.
  const ids = estado.secciones[seccion].map((item) => item.area).filter((id) => estado.areasPorId[id]);
  if (ids.length) ubicarSalones(ids, `${SECCIONES[seccion].titulo} · ${ids.length} lugar(es)`);
}

function datosLugar(item) {
  const area = estado.areasPorId[item.area];
  const piso = area ? area.ubicacion || nombreNivel(area.nivel) : "Ubicación pendiente";
  const salon = area?.codigo ? `Salón ${area.codigo}` : "";
  return { area, piso, salon };
}

function renderListaSeccion() {
  const seccion = estado.seccion;
  if (seccion === "busqueda") return;
  const filtro = $("filtroSeccion").value;
  const items = estado.secciones[seccion].filter(
    (item) => !plano(filtro) || coincidePalabras(`${item.nombre} ${item.area} ${item.descripcion || ""}`, filtro)
  );

  if (!estado.secciones[seccion].length) {
    $("listaSeccion").innerHTML = `<p class="placeholder">Aún no hay ${SECCIONES[seccion].vacio} registrados.</p>`;
    return;
  }
  if (!items.length) {
    $("listaSeccion").innerHTML = `<p class="placeholder">Nada coincide con “${escapar(filtro)}”.</p>`;
    return;
  }

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
    <div class="ficha-grupo">
      <span class="ficha-materia ficha-materia-grande">${escapar(item.nombre)}</span>
    </div>
    <p>${escapar([salon, piso].filter(Boolean).join(" · "))}</p>
    ${item.descripcion ? `<p>${escapar(item.descripcion)}</p>` : `<p class="placeholder">Información pendiente: se agregará próximamente.</p>`}
    ${campos.length ? `<dl class="ficha-grid">${campos.map(([k, v]) => `<dt>${k}</dt><dd>${escapar(v)}</dd>`).join("")}</dl>` : ""}
  `;
  document.querySelectorAll(".seccion-card").forEach((c) => c.classList.toggle("activa", c.dataset.area === id));
  if (area && estado.visor) {
    estado.visor.enfocarSalon(area.id);
    marcarNivelActivo(String(area.nivel));
    marcarVistaActiva(null);
    $("mapaEstado").textContent = `${item.nombre} · ${piso}`;
  }
}

/** Regresa el mapa a la vista inicial (sin resaltados ni pisos separados). */
function limpiarMapa() {
  if (!estado.visor) return;
  estado.visor.limpiarResaltado();
  if (estado.separado) {
    estado.separado = false;
    estado.visor.separar(false);
  }
  estado.visor.verEdificio();
  estado.visor.setTecho(estado.techoVisible);
  actualizarBotonesVisor();
  marcarNivelActivo("todos");
  marcarVistaActiva("entrada");
  $("mapaEstado").textContent = "Vista desde la entrada · elige un piso o haz clic en un salón";
}

/** Borra la búsqueda, los resaltados y regresa el mapa a la vista inicial. */
function limpiarBusqueda() {
  if (estado.seccion !== "busqueda") {
    $("filtroSeccion").value = "";
    $("detalleSeccion").hidden = true;
    renderListaSeccion();
    limpiarMapa();
    $("filtroSeccion").focus();
    return;
  }
  const input = $("searchInput");
  input.value = "";
  ocultarAutocompletado();
  $("result").innerHTML = "<p class='placeholder'>Aún no hay búsqueda.</p>";
  actualizarFotoProfesor(null);
  limpiarMapa();
  // Quita ?grupo=… de la dirección para que al recargar no vuelva la búsqueda.
  if (window.location.search) history.replaceState(null, "", window.location.pathname);
  input.focus();
}

// ---------- clases en este momento ----------

function clasesAhora() {
  if (!estado.grupos.length) return;
  ocultarAutocompletado();
  const { dia, minutos } = ahora();
  const hoy = sesionesDelDia(dia);
  const enCurso = hoy.filter((s) => s.inicio <= minutos && minutos < s.fin);
  const siguienteInicio = hoy.filter((s) => s.inicio > minutos).map((s) => s.inicio)[0];
  const siguientes = siguienteInicio === undefined ? [] : hoy.filter((s) => s.inicio === siguienteInicio);

  const tarjetas = (lista, conRestante) =>
    lista
      .map((s) => {
        const extra = conRestante
          ? ` · <strong>termina ${formatoHora(s.fin)}</strong>`
          : ` · <strong>empieza ${formatoHora(s.inicio)}</strong>`;
        return tarjetaClase(s.grupo, extra);
      })
      .join("");

  let html = `<div class="ficha-grupo"><span class="ficha-materia ficha-materia-grande">Clases en este momento</span></div>
    <p>${escapar(DIAS_LARGO[dia])} · ${formatoHora(minutos)}</p>`;

  if (!hoy.length) {
    html += `<p class="placeholder">Hoy no hay clases registradas en el L3.</p>`;
  } else if (enCurso.length) {
    html += `<p><strong>${enCurso.length}</strong> clase(s) en curso.</p><div class="clase-lista">${tarjetas(enCurso, true)}</div>`;
  } else {
    html += `<p class="placeholder">No hay clases en este momento.</p>`;
  }
  if (siguientes.length) {
    html += `<p class="sugerencia-titulo">Siguientes, a las ${formatoHora(siguienteInicio)}</p>
      <div class="clase-lista">${tarjetas(siguientes, false)}</div>`;
  }

  $("result").innerHTML = html;
  actualizarFotoProfesor(null, enCurso.length > 1);

  const resaltar = (enCurso.length ? enCurso : siguientes).map((s) => s.grupo.salon);
  if (resaltar.length) {
    ubicarSalones(resaltar, enCurso.length ? `${enCurso.length} clase(s) en curso` : `Siguientes clases · ${formatoHora(siguienteInicio)}`);
  } else if (estado.visor) {
    estado.visor.limpiarResaltado();
  }
}

// ---------- línea del tiempo (encabezado) ----------

function iniciarLineaTiempo() {
  const pista = $("ltPista");
  if (!pista) return;
  const total = FIN_DIA - INICIO_DIA;

  // Marcas de hora (etiqueta cada 2 h).
  for (let h = 7; h <= 24; h++) {
    const marca = document.createElement("span");
    marca.className = "lt-tick" + ((h - 7) % 2 === 0 ? " lt-tick-mayor" : "");
    marca.style.left = `${(((h * 60) - INICIO_DIA) / total) * 100}%`;
    if ((h - 7) % 2 === 0 || h === 24) marca.dataset.hora = h === 24 ? "24" : String(h);
    pista.appendChild(marca);
  }

  // Densidad de clases de hoy (cada media hora), como barras tenues.
  const { dia } = ahora();
  const hoy = sesionesDelDia(dia);
  const tramos = Math.ceil(total / 30);
  const conteo = Array.from({ length: tramos }, (_, i) => {
    const t = INICIO_DIA + i * 30 + 15;
    return hoy.filter((s) => s.inicio <= t && t < s.fin).length;
  });
  const maximo = Math.max(1, ...conteo);
  conteo.forEach((n, i) => {
    if (!n) return;
    const barra = document.createElement("span");
    barra.className = "lt-barra";
    barra.style.left = `${(i * 30 / total) * 100}%`;
    barra.style.width = `${(30 / total) * 100}%`;
    barra.style.height = `${20 + 80 * (n / maximo)}%`;
    barra.title = `${formatoHora(INICIO_DIA + i * 30)} · ${n} clase(s)`;
    pista.appendChild(barra);
  });

  actualizarLineaTiempo();
  setInterval(actualizarLineaTiempo, 30000);
}

function actualizarLineaTiempo() {
  const { dia, minutos } = ahora();
  const total = FIN_DIA - INICIO_DIA;
  const dentro = minutos >= INICIO_DIA && minutos <= FIN_DIA;
  const pos = Math.min(Math.max((minutos - INICIO_DIA) / total, 0), 1) * 100;
  $("ltMarca").style.left = `${pos}%`;
  $("ltPasado").style.width = `${pos}%`;
  $("ltMarca").classList.toggle("fuera", !dentro);
  const enCurso = sesionesDelDia(dia).filter((s) => s.inicio <= minutos && minutos < s.fin).length;
  $("ltHora").textContent = `${DIAS_LARGO[dia]} · ${formatoHora(minutos)}`;
  $("ltEstado").textContent = dentro ? `${enCurso} clase(s) en curso` : "Fuera del horario del L3";
}

// ---------- panel de profesor ----------

function buscarProfesor(nombre) {
  return estado.profesores.find((p) => p.nombre === nombre) || null;
}

function actualizarFotoProfesor(nombre, varios = false) {
  const foto = $("fotoProfesor");
  const texto = $("nombreProfesorFoto");
  const correo = $("correoProfesor");

  correo.classList.remove("visible");
  correo.textContent = "";

  if (!nombre) {
    foto.src = "img/profesor_generico.png";
    foto.alt = varios ? "Varios profesores" : "Foto del profesor";
    texto.textContent = varios ? "Varios maestros" : "Selecciona un maestro";
    return;
  }

  const profesor = buscarProfesor(nombre);
  foto.src = profesor?.foto || "img/profesor_generico.png";
  foto.alt = `Foto de ${nombre}`;
  foto.onerror = () => {
    foto.onerror = null;
    foto.src = "img/profesor_generico.png";
  };
  texto.textContent = nombre;

  if (profesor?.correo) {
    // Si no cabe, que se corte solo después de la @ (no a la mitad del dominio).
    const [usuario, dominio] = profesor.correo.split("@");
    correo.replaceChildren(dominio ? `${usuario}@` : usuario);
    if (dominio) correo.append(document.createElement("wbr"), dominio);
    correo.classList.add("visible");
  }
}

// ---------- visor 3D ----------

async function iniciarVisor() {
  if (!estado.modelo) return;
  try {
    const { VisorEdificio } = await import("./escena3d.js?v=27");
    estado.visor = new VisorEdificio($("visor3d"));
    estado.visor.cargar(estado.modelo);
    estado.visor.alSeleccionar = mostrarArea;

    // Capa opcional de ventanas: si falta data/fachada.json, solo hay muros.
    try {
      estado.visor.cargarFachada(await cargarJSON("data/fachada.json"));
      estado.ventanas = true;
      estado.visor.setVentanas(true);
    } catch {
      estado.ventanas = null;
      estado.visor.setVentanas(false); // sin ventanas: los huecos quedan cerrados
      $("ventanasBtn")?.setAttribute("hidden", "");
    }
    window.miceVisor = estado.visor; // para depurar desde la consola
    estado.techoVisible = true;
    estado.separado = false;
    actualizarBotonesVisor();

    const aviso = $("visorEstado");
    if (aviso) aviso.remove();
    marcarNivelActivo("todos");
    marcarVistaActiva("entrada");
    $("mapaEstado").textContent = "Vista desde la entrada · elige un piso o haz clic en un salón";
  } catch (error) {
    console.error("No se pudo iniciar el visor 3D:", error);
    const aviso = $("visorEstado");
    if (aviso) {
      aviso.textContent =
        "No se pudo cargar el modelo 3D. Revisa tu conexión (Three.js se carga desde CDN) y abre la página con un servidor local.";
      aviso.classList.add("error");
    }
  }
}

function ubicarSalon(codigo) {
  if (!estado.visor || !codigo) return;
  const nivel = nivelDeSalon(codigo) ?? estado.areasPorId[codigo]?.nivel ?? null;

  if (estado.visor.enfocarSalon(codigo)) {
    marcarNivelActivo(String(nivel));
    marcarVistaActiva(null);
    $("mapaEstado").textContent = `Salón ${codigo} · ${nombreNivel(nivel)}`;
    return;
  }

  if (nivel !== null && Number.isFinite(nivel)) {
    estado.visor.enfocarNivel(nivel);
    marcarNivelActivo(String(nivel));
    $("mapaEstado").textContent = `Salón ${codigo} no está en el modelo · ${nombreNivel(nivel)}`;
  } else {
    estado.visor.verEdificio();
    marcarNivelActivo("todos");
  }
}

/** Ilumina varios salones a la vez (materia, maestro, clases ahora). */
function ubicarSalones(codigos, mensaje) {
  if (!estado.visor) return;
  // Acepta códigos de salón (L30010) o ids de área (Grupo IDEA, ARX…).
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
  $("mapaEstado").textContent = niveles.length === 1
    ? `${mensaje} · ${nombreNivel(niveles[0])}`
    : `${mensaje} · ${niveles.length} pisos (pisos separados)`;
}

function marcarNivelActivo(nivel) {
  document.querySelectorAll(".nivelBtn[data-nivel]").forEach((btn) => {
    btn.classList.toggle("activo", btn.dataset.nivel === String(nivel));
  });
}

function marcarVistaActiva(vista) {
  document.querySelectorAll(".vistaBtn").forEach((btn) => {
    btn.classList.toggle("activo", btn.dataset.vista === String(vista));
  });
}

function actualizarBotonesVisor() {
  const techo = $("techoBtn");
  if (techo) {
    techo.textContent = estado.techoVisible ? "Techo: sí" : "Techo: no";
    techo.classList.toggle("activo", estado.techoVisible);
  }
  const ventanas = $("ventanasBtn");
  if (ventanas && estado.ventanas !== null) {
    ventanas.textContent = estado.ventanas ? "Ventanas: sí" : "Ventanas: no";
    ventanas.classList.toggle("activo", Boolean(estado.ventanas));
  }
  const separar = $("separarBtn");
  if (separar) {
    separar.textContent = estado.separado ? "Juntar pisos" : "Separar pisos";
    separar.classList.toggle("activo", estado.separado);
  }
}

const NOMBRE_TIPO = {
  salon: "Salón de clases",
  apoyo: "Área de gestión de apoyo",
  grupo: "Grupo estudiantil",
  servicio: "Servicio para alumnos",
  restringido: "Solo personal autorizado",
  bano: "Sanitarios",
};

/** Se llama al hacer clic en un área del modelo 3D. */
function mostrarArea(area) {
  marcarNivelActivo(String(area.nivel));
  marcarVistaActiva(null);
  $("mapaEstado").textContent = area.tipo === "bano"
    ? `${area.nombre} · descanso de la escalera`
    : `${area.codigo || area.nombre} · ${nombreNivel(area.nivel)}`;
  actualizarFotoProfesor(null);

  const titulo = escapar(
    [area.codigo, area.nombre !== area.codigo ? area.nombre : null, area.alias]
      .filter(Boolean)
      .join(" · ")
  );
  const grupos = area.codigo
    ? estado.gruposOrdenados.filter((g) => g.salon === area.codigo)
    : [];

  const lista = grupos
    .map((g) => {
      const horario = (g.sesiones || []).map((s) => `${s.dia} ${s.hora}`).join(" · ");
      return `
        <article class="clase-card">
          <div class="clase-head">
            <button type="button" class="clase-grupo" data-grupo="${escapar(g.grupo)}">${escapar(g.grupo)}</button>
            <span class="clase-salon">${escapar(horario || "Horario pendiente")}</span>
          </div>
          <p class="clase-materia">${escapar(g.materia)}</p>
          <p class="clase-meta">${escapar(g.profesor)}</p>
        </article>`;
    })
    .join("");

  $("result").innerHTML = `
    <div class="ficha-grupo">
      <span class="grupo-codigo">${titulo}</span>
      <span class="ficha-materia">${escapar(area.descripcion || `${NOMBRE_TIPO[area.tipo] || ""} · ${area.ubicacion || nombreNivel(area.nivel)}`)}</span>
    </div>
    ${area.descripcion && area.ubicacion ? `<p class="placeholder">${escapar(area.ubicacion)}.</p>` : ""}
    ${area.tipo === "bano" ? "" : grupos.length
      ? `<p><strong>${grupos.length}</strong> grupo(s) en este salón${estado.semestre ? ` (semestre ${escapar(estado.semestre)})` : ""}.</p>
         <div class="clase-lista">${lista}</div>`
      : `<p class="placeholder">No hay grupos registrados en esta área.</p>`}
  `;
}

function etiquetaVista(vista) {
  const nombre = {
    entrada: "Vista desde la entrada · poniente",
    n: "Vista norte",
    s: "Vista sur",
    e: "Vista este",
    o: "Vista oeste",
    ne: "Isométrica noreste",
    no: "Isométrica noroeste",
    se: "Isométrica sureste",
    so: "Isométrica suroeste",
  }[vista] || "Vista del edificio";
  return `${nombre} · clic derecho para mover`;
}

// ---------- errores ----------

function marcarModeloNoDisponible() {
  const aviso = $("visorEstado");
  if (!aviso) return;
  aviso.textContent =
    "Modelo 3D no disponible. Genera data/edificio.json con scripts/generar_modelo.py.";
  aviso.classList.add("error");
}

function mostrarErrorCarga(error) {  $("result").innerHTML = `
    <p class="aviso">
      No se pudieron cargar los datos (${escapar(error.message)}).
      Abre el proyecto con un servidor local, por ejemplo
      <code>python -m http.server 8000</code>, y visita
      <code>http://localhost:8000</code>.
    </p>`;
  const aviso = $("visorEstado");
  if (aviso) {
    aviso.textContent = "Modelo 3D no disponible.";
    aviso.classList.add("error");
  }
}
