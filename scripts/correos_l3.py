"""Busca los correos de los profesores en la página oficial del L3 (FES Aragón).

Lee la página (HTML o PDF), encuentra cada correo y lo asigna al profesor cuyo
nombre aparece junto a él (o cuyo nombre forma el correo, p. ej.
salvadoraguirre55@ -> AGUIRRE GUTIERREZ SALVADOR). Solo asigna un correo cuando
la coincidencia es clara; los dudosos se reportan para revisarlos a mano.

Lo usa scripts/actualizar_semestre.py con la opción --correos.
"""

import io
import re
import unicodedata
from html.parser import HTMLParser
from urllib.request import Request, urlopen

# Página oficial con los correos de los profesores del L3.
URL_CORREOS = "https://sites.google.com/aragon.unam.mx/laboratorio-l3/directorio/profesores"

PATRON_CORREO = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PALABRAS_VACIAS = {"DE", "LA", "DEL", "LOS", "LAS", "Y", "ING", "DR", "DRA", "MTRO", "MTRA", "LIC"}
VENTANA_ANTES = 250   # caracteres antes del correo donde se busca el nombre
VENTANA_DESPUES = 100


def plano(texto):
    """Mayúsculas, sin acentos ni signos: 'García Guzmán' -> 'GARCIA GUZMAN'."""
    sin_acentos = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9 ]+", " ", sin_acentos.upper()).split()


def palabras_del_nombre(nombre):
    return {p for p in plano(nombre) if len(p) >= 3 and p not in PALABRAS_VACIAS}


class _Texto(HTMLParser):
    """Texto de la página con los correos de los enlaces mailto: incluidos."""

    BLOQUES = {"p", "div", "tr", "li", "td", "th", "br", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article"}

    OCULTOS = {"script", "style", "noscript", "template"}

    def __init__(self):
        super().__init__()
        self.partes = []
        self.oculto = 0  # dentro de <script>/<style>: no es texto visible

    def handle_starttag(self, tag, attrs):
        if tag in self.OCULTOS:
            self.oculto += 1
            return
        if tag in self.BLOQUES:
            self.partes.append("\n")
        href = dict(attrs).get("href") or ""
        if href.lower().startswith("mailto:"):
            self.partes.append(f" {href[7:].split('?')[0]} ")

    def handle_endtag(self, tag):
        if tag in self.OCULTOS and self.oculto:
            self.oculto -= 1

    def handle_data(self, data):
        if not self.oculto:
            self.partes.append(data)

    def texto(self):
        return "".join(self.partes)


def descargar_texto(url):
    """Texto de la página (HTML o PDF)."""
    peticion = Request(url, headers={"User-Agent": "MICE-L3/1.0 (actualizador de horarios)"})
    with urlopen(peticion, timeout=30) as r:
        tipo = r.headers.get("Content-Type", "")
        datos = r.read()
    if "pdf" in tipo or url.lower().endswith(".pdf") or datos[:4] == b"%PDF":
        import pdfplumber

        with pdfplumber.open(io.BytesIO(datos)) as pdf:
            return "\n".join(pagina.extract_text() or "" for pagina in pdf.pages)
    lector = _Texto()
    lector.feed(datos.decode(r.headers.get_content_charset() or "utf-8", errors="replace"))
    return lector.texto()


def parecidas(a, b):
    """Misma palabra o con una letra distinta, de más o de menos (GONZALES/GONZALEZ, DIAS/DIAZ)."""
    if a == b:
        return True
    if min(len(a), len(b)) < 4 or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    corta, larga = sorted((a, b), key=len)
    return any(larga[:i] + larga[i + 1:] == corta for i in range(len(larga)))


def puntaje(nombre, contexto, correo):
    """(palabras del nombre junto al correo o dentro de él, palabras dentro del correo) para ordenar.

    Junto al correo deben estar los dos apellidos: así "VEGA RAMIREZ ALEJANDRO ANTONIO"
    no se confunde con "RAMIREZ FLORES ANTONIO".
    """
    orden = [p for p in plano(nombre) if len(p) >= 3 and p not in PALABRAS_VACIAS]
    # Cada palabra del contexto se usa una sola vez: "HERNANDEZ HERNANDEZ" necesita dos.
    disponibles = plano(contexto)
    presentes = []
    for i, p in enumerate(orden):
        j = next((k for k, c in enumerate(disponibles) if parecidas(p, c)), None)
        if j is not None:
            presentes.append(i)
            disponibles.pop(j)
    apellidos = [0, 1] if len(orden) >= 3 else [0]
    cerca = len(presentes) if all(a in presentes for a in apellidos) else 0
    # El usuario del correo (salvadoraguirre55@) solo desempata: dos profesores pueden compartir nombre y apellido.
    usuario = "".join(plano(correo.split("@")[0].replace(".", " ")))
    dentro = sum(1 for p in orden if len(p) >= 4 and p in usuario)
    return (cerca, dentro)


def asignar_correos(texto, nombres):
    """{nombre: correo} con las coincidencias claras y [(correo, motivo)] de las dudosas."""
    encontrados = []
    fin_anterior = 0
    for m in PATRON_CORREO.finditer(texto):
        # Antes: hasta el correo anterior. Después: solo el resto de su renglón (no el nombre de la fila siguiente).
        inicio = max(fin_anterior, m.start() - VENTANA_ANTES)
        fin_renglon = texto.find("\n", m.end())
        fin = min(fin_renglon if fin_renglon != -1 else len(texto), m.end() + VENTANA_DESPUES)
        contexto = texto[inicio:fin]
        encontrados.append((m.group(0).strip(".").lower(), contexto))
        fin_anterior = m.end()

    candidatos = []  # (puntaje, correo, nombre)
    dudosos = []
    for correo, contexto in dict(encontrados).items():
        notas = sorted(((puntaje(n, contexto, correo), n) for n in nombres), reverse=True)
        mejor = notas[0] if notas else ((0, 0), None)
        segundo = notas[1][0] if len(notas) > 1 else (0, 0)
        if mejor[0][0] >= 2 and mejor[0] > segundo:
            candidatos.append((mejor[0], correo, mejor[1]))
        elif mejor[0][0] >= 2:
            dudosos.append((correo, "coincide con más de un profesor"))

    asignados, usados = {}, set()
    for _, correo, nombre in sorted(candidatos, key=lambda c: c[0], reverse=True):
        if nombre not in asignados and correo not in usados:
            asignados[nombre] = correo
            usados.add(correo)
    return asignados, dudosos


def buscar_correos(nombres, url=None):
    url = url or URL_CORREOS
    if not url:
        raise ValueError("Falta la dirección de la página con los correos (URL_CORREOS en scripts/correos_l3.py o --correos URL).")
    return asignar_correos(descargar_texto(url), nombres)
