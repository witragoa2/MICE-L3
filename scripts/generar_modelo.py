"""Convierte el modelo 3D del L3 (AutoCAD, 3DSOLID) en data/edificio.json.

Lee la geometría exacta de cada sólido ACIS del DXF "Laboratorio 3 Edificio
Completo - 3D" (los tres pisos ya están apilados en AutoCAD).

Uso:
    python scripts/generar_modelo.py
    python scripts/generar_modelo.py --dxf "ruta/al/archivo.dxf" --sin-huecos

Reglas del DXF:
  * Cada salón/área es un sólido cuyo bloque o capa lleva su nombre (L-30010, JEFATURA…).
  * Muros y losas en las capas "0", "Primer Nivel" y "Segundo Nivel"; puertas en
    "A-Puertas"; escaleras en "A-Escaleras" y "Escaleras de emergencia"; techo en "Techo".
  * Solo caras planas.
"""

import argparse
import json
import math
import re
from collections import defaultdict
from datetime import date
from pathlib import Path

import ezdxf
from ezdxf.acis import api as acis
from ezdxf.acis import sab
from ezdxf.acis.const import Tags
from ezdxf.math import Vec3
from ezdxf.math.triangulation import mapbox_earcut_3d

RAIZ = Path(__file__).resolve().parent.parent
DXF_POR_DEFECTO = RAIZ / "modelos" / "Laboratorio_3_Edificio_Completo_3D.dxf"
SALIDA = RAIZ / "data" / "edificio.json"


# ---------------------------------------------------------------------------
# Parche para ezdxf 1.4: AutoCAD guarda la transformación del sólido como
# vectores binarios y ezdxf espera texto.
# ---------------------------------------------------------------------------
_leer_transformacion_original = sab.SabDataLoader.read_transform


def _leer_transformacion(self):
    if self.data[self.index].tag in (Tags.STR, Tags.LITERAL_STR):
        return _leer_transformacion_original(self)
    valores = []
    for _ in range(4):  # 3 filas de rotación + traslación
        valores.extend(self.read_vec3())
    return valores


sab.SabDataLoader.read_transform = _leer_transformacion


# ---------------------------------------------------------------------------
# Configuración del edificio (coordenadas AutoCAD, metros)
# ---------------------------------------------------------------------------
NIVELES = [
    {"id": 0, "nombre": "Planta baja", "piso": 0.0},
    {"id": 1, "nombre": "Primer piso", "piso": 3.57},
    {"id": 2, "nombre": "Segundo piso", "piso": 6.97},
]
CAPAS_ESTRUCTURA = {"0": 0, "Primer Nivel": 1, "Segundo Nivel": 2}

# Nombre visible y categoría (colores de los planos 2D).
AREAS = {
    "JEFATURA": ("Jefatura L3", "apoyo"),
    "Jefatura L3": ("Jefatura L3", "apoyo"),
    "Almacén EYM y ACE": ("Almacén EYM/ACE", "apoyo"),
    "Almacén de máquinas de electricidad y magnetismo": ("Almacén máq. eléc. y de potencia", "apoyo"),
    "SPA-1": ("Solo personal autorizado", "restringido"),
    "SPA-2": ("Solo personal autorizado", "restringido"),
    "SPA-3": ("Solo personal autorizado", "restringido"),
    "SPA-4": ("Solo personal autorizado", "restringido"),
    "SPA-5": ("Solo personal autorizado", "restringido"),
    "Grupo IMED": ("Grupo IMED", "grupo"),
    "Centro de Canje": ("Centro de Canje", "servicio"),
    "Salón de Servicio Social": ("Servicio Social L3", "apoyo"),
    "Almacén de Electrónica": ("Almacén Electrónica", "apoyo"),
    "Almacén de medición e instrumentación": ("Almacén Medición e Instrumentación", "apoyo"),
    "Baño Hombres P1": ("Baño Hombres P1", "bano"),
    "Baño Mujeres P1": ("Baño Mujeres P1", "bano"),
    "Baño Hombres P2": ("Baño Hombres P2", "bano"),
    "Baño Mujeres P2": ("Baño Mujeres P2", "bano"),
    "Grupo IDEA": ("Grupo IDEA", "grupo"),
    "Grupo REX": ("Grupo REX", "grupo"),
    "Club de mecatrónica": ("Club de Mecatrónica", "grupo"),
    "ARX": ("ARX", "grupo"),
    "MAKER": ("MAKER", "servicio"),
    "Almacén de control": ("Almacén Control", "apoyo"),
    "Almacén de comunicación": ("Almacén Comunicaciones", "apoyo"),
}

# Áreas que en el horario aparecen con un código de salón.
ALIAS_CODIGO = {"Grupo REX": "L32012"}

# Segundo nombre según los planos: (nombre completo, texto corto, categoría o None).
NOMBRE_ALTERNO = {
    "L-30010": ("EYM", "EYM", None),
    "L-30011": ("ACE", "ACE", None),
    "L-30022": ("IASE", "IASE", "grupo"),
    "L-30024": ("AMPERIO Aprendices", "AMPERIO", "grupo"),
    "Grupo IMED": ("LIMA", "LIMA", "grupo"),
    "L-31020": ("Centro de Cómputo y Capacitación de Proyectos de Ingeniería L3", "Centro de Cómputo", None),
    "L-32015": ("3D", "3D", None),
}

# Áreas que no se muestran (SPA-1: hueco bajo la escalera, junto a Jefatura).
AREAS_OMITIR = {"SPA-1"}

# Planta corregida para que el área no se meta en muros ni columnas.
AREA_PLANTA = {
    "Baño Hombres P2": [(1300.57, 2449.99), (1303.87, 2449.99), (1303.87, 2444.89),
                        (1300.27, 2444.89), (1300.27, 2449.64), (1300.57, 2449.64)],
    "Baño Mujeres P2": [(1303.97, 2444.89), (1303.97, 2449.99), (1307.27, 2449.99),
                        (1307.27, 2449.69), (1307.57, 2449.69), (1307.57, 2444.89)],
    "L-32010": [(1310.87, 2453.60), (1317.62, 2453.60), (1317.62, 2450.49), (1310.87, 2450.49)],
    "Club de mecatrónica": [(1324.02, 2453.60), (1324.83, 2452.81), (1324.83, 2450.49),
                            (1317.72, 2450.49), (1317.72, 2453.60)],
}

# Baños de los descansos de la escalera: piso con el que viajan, ubicación y descripción.
NIVEL_FORZADO = {"Baño Hombres P1": 0, "Baño Mujeres P1": 0, "Baño Hombres P2": 1, "Baño Mujeres P2": 1}
_DESCANSO_1 = "Descanso de la escalera, entre planta baja y primer piso"
_DESCANSO_2 = "Descanso de la escalera, entre primer y segundo piso"
UBICACION = {
    "Baño Hombres P1": _DESCANSO_1 + " (a la derecha subiendo)",
    "Baño Mujeres P1": _DESCANSO_1 + " (a la izquierda subiendo)",
    "Baño Hombres P2": _DESCANSO_2 + " (a la derecha subiendo)",
    "Baño Mujeres P2": _DESCANSO_2 + " (a la izquierda subiendo)",
}
_DESC_P1 = "Sanitarios - Exclusivo para profesores y personal de laboratorio."
_DESC_P2 = "Sanitarios - Favor de solicitar las llaves en jefatura para entrar y usarlos."
DESCRIPCION = {
    "Baño Hombres P1": _DESC_P1, "Baño Mujeres P1": _DESC_P1,
    "Baño Hombres P2": _DESC_P2, "Baño Mujeres P2": _DESC_P2,
}

# Puertas que faltan en el DXF: (punto A, punto B, z piso, z techo, grosor, nivel).
PUERTAS_EXTRA = [
    ((1302.62, 2450.04), (1303.37, 2450.04), 1.80, 4.80, 0.08, 0),  # Baño Hombres P1
    ((1304.47, 2450.04), (1305.22, 2450.04), 1.80, 4.80, 0.08, 0),  # Baño Mujeres P1
    ((1302.62, 2450.04), (1303.37, 2450.04), 5.37, 8.37, 0.08, 1),  # Baño Hombres P2
    ((1304.47, 2450.04), (1305.22, 2450.04), 5.37, 8.37, 0.08, 1),  # Baño Mujeres P2
    ((1324.07, 2453.65), (1324.595, 2453.11), 6.97, 9.97, 0.10, 2),  # Club de Mecatrónica (diagonal)
    ((1340.18, 2454.34), (1340.18, 2455.09), 6.97, 9.97, 0.10, 2),  # L32021
    ((1322.62, 2450.49), (1322.62, 2451.24), 0.00, 3.00, 0.10, 0),  # Almacén EYM/ACE
]
# Punto de la etiqueta cuando el centro del área queda tapado por otra (X, Y en planta).
POSICION_ETIQUETA = {
    "Almacén de medición e instrumentación": (1336.045, 2455.44),  # parte libre, fuera de L31015
}
ALTO_PUERTA = 2.1
SALIDA_EMERGENCIA = (1329.8, 1331.45, 2461.9, 2462.2)  # puertas a la escalera de emergencia
PUERTA_ENTRADA = (1303.2, 1304.6, 2458.4, 2459.7)      # puerta principal de vidrio

# Sólidos que se omiten: (capa, xmin, xmax, ymin, ymax, zmin desde, zmin hasta).
EXCLUIR = [
    ("Escaleras de emergencia", 1329.22, 1334.12, 2466.49, 2468.49, 1.9, 2.1),  # descanso que no existe
    ("Techo", 1300.17, 1307.67, 2444.79, 2450.09, 8.3, 8.4),                   # techo de baños mal cortado
]
# Sólidos que se desplazan: (xmin, xmax, ymin, ymax, (dx, dy, dz)).
MOVER = [
    (1300.17, 1300.57, 2461.64, 2462.44, (0.0, 0.35, 0.0)),  # pilar de la entrada, a la esquina del techo
]
# Cajas que se agregan: (capa, x0, x1, y0, y1, z0, z1).
AGREGAR = [
    ("Escaleras de emergencia", 1329.22, 1331.67, 2466.49, 2468.49, 1.97, 2.17),
]
# Prismas que se agregan: (capa, planta, z0, z1).
AGREGAR_PRISMAS = [
    ("Techo", [(1300.17, 2444.79), (1307.67, 2444.79), (1307.67, 2449.64), (1307.27, 2449.64),
               (1307.27, 2449.99), (1300.57, 2449.99), (1300.57, 2449.64), (1300.17, 2449.64)], 8.37, 8.77),
]

CARAS_CAJA = ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))


# ---------------------------------------------------------------------------
# Geometría
# ---------------------------------------------------------------------------
def a_three(p, centro):
    """AutoCAD (X este, Y norte, Z arriba) -> Three.js (x, y arriba, z sur)."""
    return (round(p.x - centro[0], 3), round(p.z, 3), round(-(p.y - centro[1]), 3))


class Acumulador:
    """Junta caras en una malla (vértices compartidos dentro de cada cara)."""

    def __init__(self):
        self.vertices = []
        self.indices = []
        self.min = [1e9] * 3
        self.max = [-1e9] * 3

    def agregar_cara(self, poligono, centro, elevar=0.0, huecos=None):
        if len(poligono) < 3:
            return
        if len(poligono) == 3 and not huecos:
            triangulos = [tuple(poligono)]
        else:
            try:
                triangulos = list(mapbox_earcut_3d(poligono, huecos or None))
            except Exception:
                triangulos = [(poligono[0], poligono[i], poligono[i + 1]) for i in range(1, len(poligono) - 1)]
        indice_de = {}
        for tri in triangulos:
            for p in tri:
                x, y, z = a_three(p, centro)
                clave = (x, round(y + elevar, 3), z)
                if clave not in indice_de:
                    indice_de[clave] = len(self.vertices) // 3
                    self.vertices.extend(clave)
                    for i, v in enumerate(clave):
                        self.min[i] = min(self.min[i], v)
                        self.max[i] = max(self.max[i], v)
                self.indices.append(indice_de[clave])

    def bbox(self):
        return [round(v, 3) for v in self.min + self.max]


def normal(poligono):
    n = Vec3()
    for i, a in enumerate(poligono):
        b = poligono[(i + 1) % len(poligono)]
        n += Vec3((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y))
    return n.normalize() if n.magnitude > 1e-12 else n


def extremos(caras):
    """(xmin, xmax, ymin, ymax, zmin, zmax) de un conjunto de caras."""
    ps = [p for c in caras for p in c]
    return (min(p.x for p in ps), max(p.x for p in ps), min(p.y for p in ps),
            max(p.y for p in ps), min(p.z for p in ps), max(p.z for p in ps))


def caras_caja(x0, x1, y0, y1, z0, z1):
    v = [Vec3(x0, y0, z0), Vec3(x1, y0, z0), Vec3(x1, y1, z0), Vec3(x0, y1, z0),
         Vec3(x0, y0, z1), Vec3(x1, y0, z1), Vec3(x1, y1, z1), Vec3(x0, y1, z1)]
    return [[v[i] for i in c] for c in CARAS_CAJA]


def caras_prisma(planta, z0, z1):
    abajo = [Vec3(x, y, z0) for x, y in planta]
    arriba = [Vec3(x, y, z1) for x, y in planta]
    caras = [list(reversed(abajo)), arriba]
    for i in range(len(planta)):
        j = (i + 1) % len(planta)
        caras.append([abajo[i], abajo[j], arriba[j], arriba[i]])
    return caras


def caja_orientada(acc, centro, p, q, ancho, alto):
    """Barra de sección ancho × alto entre los puntos p y q."""
    p, q = Vec3(p), Vec3(q)
    d = q - p
    if d.magnitude < 1e-6:
        return
    d = d.normalize()
    u = Vec3(0, 0, 1).cross(d)
    if u.magnitude < 1e-6:  # barra vertical
        u = Vec3(1, 0, 0)
    u = u.normalize() * (ancho / 2)
    v = d.cross(u).normalize() * (alto / 2)
    esq = [p - u - v, p + u - v, p + u + v, p - u + v, q - u - v, q + u - v, q + u + v, q - u + v]
    for cara in CARAS_CAJA:
        acc.agregar_cara([esq[i] for i in cara], centro)


def coincide_extremos(bb, x0, x1, y0, y1):
    return abs(bb[0] - x0) < 0.02 and abs(bb[1] - x1) < 0.02 and abs(bb[2] - y0) < 0.02 and abs(bb[3] - y1) < 0.02


def dentro_de(bb, caja):
    x0, x1, y0, y1 = caja
    return bb[0] >= x0 and bb[1] <= x1 and bb[2] >= y0 and bb[3] <= y1


def excluido(capa, caras):
    bb = extremos(caras)
    return any(capa == c and coincide_extremos(bb, x0, x1, y0, y1) and z0 <= bb[4] <= z1
               for c, x0, x1, y0, y1, z0, z1 in EXCLUIR)


def desplazar(capa, caras):
    if capa not in CAPAS_ESTRUCTURA:
        return caras
    bb = extremos(caras)
    for x0, x1, y0, y1, d in MOVER:
        if coincide_extremos(bb, x0, x1, y0, y1):
            v = Vec3(d)
            return [[p + v for p in c] for c in caras]
    return caras


# ---------------------------------------------------------------------------
# Lectura del DXF
# ---------------------------------------------------------------------------
def caras_de_solido(entidad, matriz=None):
    """Caras planas (polígonos Vec3) del sólido."""
    caras = []
    for cuerpo in acis.load_dxf(entidad):
        for malla in acis.mesh_from_body(cuerpo):
            vertices = malla.vertices if matriz is None else list(matriz.transform_vertices(malla.vertices))
            caras.extend([Vec3(vertices[i]) for i in cara] for cara in malla.faces)
    return caras


def recorrer_solidos(doc):
    """(nombre, capa, caras) de cada 3DSOLID, incluidos los de bloques."""
    vistos = set()
    for entidad in doc.modelspace():
        if entidad.dxftype() == "3DSOLID":
            yield entidad.dxf.layer, entidad.dxf.layer, caras_de_solido(entidad)
        elif entidad.dxftype() == "INSERT":
            nombre = entidad.dxf.name
            matriz = entidad.matrix44()
            clave = (nombre, tuple(round(v, 3) for v in matriz))
            if clave in vistos:  # bloque insertado dos veces en el mismo lugar
                continue
            vistos.add(clave)
            for sub in doc.blocks[nombre]:
                if sub.dxftype() == "3DSOLID":
                    capa = sub.dxf.layer if sub.dxf.layer != "0" else entidad.dxf.layer
                    yield nombre, capa, caras_de_solido(sub, matriz)


def codigo_salon(nombre):
    if nombre in ALIAS_CODIGO:
        return ALIAS_CODIGO[nombre]
    m = re.fullmatch(r"L-?(\d{5})", nombre.strip(), re.IGNORECASE)
    return f"L{m.group(1)}" if m else None


def nivel_por_altura(z):
    return 0 if z < 3.4 else 1 if z < 6.8 else 2


def nivel_emergencia(zmax):
    """Escalera de emergencia: mitad baja con el primer piso, mitad alta con el segundo."""
    return 1 if zmax <= 3.6 else 2


# ---------------------------------------------------------------------------
# Puertas
# ---------------------------------------------------------------------------
def puerta_estilo(hoja, marco, centro, a, b, z0, z1, grosor):
    """Hoja + panel superior + marco de aluminio; doble si el vano mide más de 1.2 m."""
    a, b = Vec3(a[0], a[1], 0), Vec3(b[0], b[1], 0)
    largo = (b - a).magnitude
    if largo < 0.2:
        return
    d = (b - a).normalize()
    m = 0.04  # perfil de aluminio
    zd = min(z0 + ALTO_PUERTA, z1)

    def pieza(acc, s0, s1, za, zb, g):
        if zb - za < 0.01 or s1 - s0 < 0.01:
            return
        zm = (za + zb) / 2
        p, q = a + d * s0, a + d * s1
        caja_orientada(acc, centro, Vec3(p.x, p.y, zm), Vec3(q.x, q.y, zm), g, zb - za)

    pieza(hoja, m, largo - m, z0, zd - m / 2, grosor - 0.02)          # hoja
    if z1 - zd > 0.1:
        pieza(hoja, m, largo - m, zd + m / 2, z1 - m, grosor - 0.02)  # panel superior
    pieza(marco, 0, m, z0, z1, grosor)                                 # jambas
    pieza(marco, largo - m, largo, z0, z1, grosor)
    pieza(marco, 0, largo, zd - m / 2, zd + m / 2, grosor)             # travesaño
    pieza(marco, 0, largo, z1 - m, z1, grosor)                         # cabezal
    if largo > 1.2:
        pieza(marco, largo / 2 - m / 2, largo / 2 + m / 2, z0, zd, grosor)  # parteluz


def vano_de_puerta(caras, bb):
    """(a, b, grosor) del vano a partir del sólido de puerta del DXF."""
    x0, x1, y0, y1 = bb[:4]
    if x1 - x0 <= 0.2 and (y1 - y0) > (x1 - x0):
        xc = (x0 + x1) / 2
        return (xc, y0), (xc, y1), x1 - x0
    if y1 - y0 <= 0.2:
        yc = (y0 + y1) / 2
        return (x0, yc), (x1, yc), y1 - y0
    # Puerta en diagonal: la cara vertical más ancha da la dirección.
    def ancho(par):
        return math.hypot(par[0].x - par[1].x, par[0].y - par[1].y)

    mejor = max((c for c in caras if abs(normal(c).z) < 0.1), key=lambda c: max(ancho((p, q)) for p in c for q in c))
    p, q = max(((p, q) for p in mejor for q in mejor), key=ancho)
    n = normal(mejor)
    ps = [v for c in caras for v in c]
    t = (sum(v.x for v in ps) / len(ps) - p.x) * n.x + (sum(v.y for v in ps) / len(ps) - p.y) * n.y
    return (p.x + n.x * t, p.y + n.y * t), (q.x + n.x * t, q.y + n.y * t), 0.1


# ---------------------------------------------------------------------------
# Huecos de ventana (lo recortado se guarda como "tapa" para "Ventanas: no")
# ---------------------------------------------------------------------------
def _dentro(pt, poligono):
    x, y = pt
    dentro = False
    for i in range(len(poligono)):
        x1, y1 = poligono[i]
        x2, y2 = poligono[(i + 1) % len(poligono)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            dentro = not dentro
    return dentro


def huecos_en_cara(cara, huecos):
    """Huecos que caen dentro de esta cara de muro (los marca como usados)."""
    n_cara = normal(cara)
    if abs(n_cara.z) > 0.1:
        return []
    salida = []
    for h in huecos:
        n = Vec3(h["n"][0], h["n"][1], 0)
        if abs(n_cara.dot(n)) < 0.99:
            continue
        a, b = Vec3(h["a"][0], h["a"][1], 0), Vec3(h["b"][0], h["b"][1], 0)
        d = (b - a).normalize()
        dist = [(Vec3(p.x, p.y, 0) - a).dot(n) for p in cara]
        if not all(-h["grosor"] - 0.03 <= s <= 0.03 for s in dist):
            continue
        uv = [((Vec3(p.x, p.y, 0) - a).dot(d), p.z) for p in cara]
        u0 = max(0.0, min(u for u, _ in uv) + 0.01)
        u1 = min((b - a).magnitude, max(u for u, _ in uv) - 0.01)
        v0 = max(h["z0"], min(v for _, v in uv) + 0.01)
        v1 = min(h["z1"], max(v for _, v in uv) - 0.01)
        if u1 - u0 < 0.1 or v1 - v0 < 0.1:
            continue
        esquinas = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        if not all(_dentro(e, uv) for e in esquinas) or any(u0 < u < u1 and v0 < v < v1 for u, v in uv):
            continue
        base = a + n * (sum(dist) / len(dist))
        salida.append([Vec3((base + d * u).x, (base + d * u).y, v) for u, v in esquinas])
        h["usado"] = True
    return salida


def caras_de_hueco(h, con_frentes):
    """Jambas del hueco (y frente/fondo cuando es la tapa)."""
    a, b = Vec3(h["a"][0], h["a"][1], 0), Vec3(h["b"][0], h["b"][1], 0)
    n = Vec3(h["n"][0], h["n"][1], 0)
    o = [Vec3(a.x, a.y, h["z0"]), Vec3(b.x, b.y, h["z0"]), Vec3(b.x, b.y, h["z1"]), Vec3(a.x, a.y, h["z1"])]
    i = [p - n * h["grosor"] for p in o]
    caras = [[o[0], o[1], i[1], i[0]], [o[3], o[2], i[2], i[3]], [o[0], o[3], i[3], i[0]], [o[1], o[2], i[2], i[1]]]
    return caras + [o, i] if con_frentes else caras


# ---------------------------------------------------------------------------
# Barandales de la escalera de emergencia
# ---------------------------------------------------------------------------
def barandales_emergencia(piezas, centro):
    """Barandales a partir de los escalones y descansos; devuelve {nivel: Acumulador}."""
    ALTO, ALTO_MEDIO, POSTE, TUBO = 0.95, 0.45, 0.045, 0.05
    salida = defaultdict(Acumulador)
    escalones = sorted((b for b in piezas if b[3] - b[2] <= 0.35), key=lambda b: (round(b[0], 2), round(b[1], 2), b[2]))
    descansos = [b for b in piezas if b[3] - b[2] > 1.2 and b[5] > 0.3]

    def barra(acc, a, b):
        caja_orientada(acc, centro, a + Vec3(0, 0, ALTO), b + Vec3(0, 0, ALTO), TUBO, TUBO)
        caja_orientada(acc, centro, a + Vec3(0, 0, ALTO_MEDIO), b + Vec3(0, 0, ALTO_MEDIO), TUBO * 0.7, TUBO * 0.7)

    def poste(acc, base):
        caja_orientada(acc, centro, base, base + Vec3(0, 0, ALTO), POSTE, POSTE)

    # Tramos: escalones contiguos del mismo ancho con alturas seguidas.
    tramos = []
    for b in escalones:
        for t in tramos:
            u = t[-1]
            if abs(u[0] - b[0]) < 0.02 and abs(u[1] - b[1]) < 0.02 and abs(u[3] - b[2]) < 0.05 and 0.05 < abs(u[5] - b[5]) < 0.26:
                t.append(b)
                break
        else:
            tramos.append([b])
    tramos = [t for t in tramos if len(t) >= 3]

    for t in tramos:
        acc = salida[nivel_emergencia(max(b[5] for b in t))]
        primero, ultimo = t[0], t[-1]
        for x in (primero[0] + 0.06, primero[1] - 0.06):
            barra(acc, Vec3(x, primero[2], primero[5]), Vec3(x, ultimo[3], ultimo[5]))
            for e in t[::3]:
                poste(acc, Vec3(x, (e[2] + e[3]) / 2, e[5]))

    def ocupado(desc, y):
        """Tramos de borde por donde se sube o se baja (sin barandal)."""
        return [(e[0], e[1]) for t in tramos for e in (t[0], t[-1])
                if (abs(e[2] - y) < 0.06 or abs(e[3] - y) < 0.06) and abs(e[5] - desc[5]) < 0.3]

    def restar(a, b, ocupados):
        segmentos = [(a, b)]
        for o0, o1 in ocupados:
            nuevos = []
            for s0, s1 in segmentos:
                if o1 <= s0 or o0 >= s1:
                    nuevos.append((s0, s1))
                    continue
                if o0 > s0:
                    nuevos.append((s0, o0))
                if o1 < s1:
                    nuevos.append((o1, s1))
            segmentos = nuevos
        return [s for s in segmentos if s[1] - s[0] > 0.2]

    for d in descansos:
        x0, x1, y0, y1, _, z = d
        acc = salida[nivel_emergencia(z)]
        junto_al_edificio = abs(y0 - 2462.09) < 0.06
        bordes = []
        for yb in (y1,) if junto_al_edificio else (y0, y1):
            off = -0.06 if yb == y1 else 0.06
            bordes += [(Vec3(s0, yb + off, z), Vec3(s1, yb + off, z)) for s0, s1 in restar(x0, x1, ocupado(d, yb))]
        for xb, off in ((x0, 0.06), (x1, -0.06)):
            bordes.append((Vec3(xb + off, y0 + (0.1 if junto_al_edificio else 0), z), Vec3(xb + off, y1, z)))
        for a, b in bordes:
            barra(acc, a, b)
            n = max(1, round((b - a).magnitude / 1.1))
            for k in range(n + 1):
                poste(acc, a + (b - a) * (k / n))
    return salida


# ---------------------------------------------------------------------------
def construir_area(nombre, caras, centro):
    zmin = min(p.z for c in caras for p in c)
    if nombre in AREA_PLANTA:
        caras = caras_prisma(AREA_PLANTA[nombre], zmin, max(p.z for c in caras for p in c))
    codigo = codigo_salon(nombre)
    visible, categoria = AREAS.get(nombre, (codigo, "salon"))
    alias, alias_corto, categoria_plano = NOMBRE_ALTERNO.get(nombre, (None, None, None))
    volumen, piso = Acumulador(), Acumulador()
    for cara in caras:
        volumen.agregar_cara(cara, centro)
        if abs(normal(cara).z) > 0.95 and all(abs(p.z - zmin) < 0.01 for p in cara):
            piso.agregar_cara(cara, centro, elevar=0.02)
    bbox = volumen.bbox()
    etiqueta = POSICION_ETIQUETA.get(nombre)
    return {
        "id": codigo or nombre,
        "codigo": codigo,
        "nombre": visible,
        "alias": alias,
        "etiqueta": " · ".join(p for p in (codigo, visible if visible != codigo else None, alias_corto) if p),
        "tipo": categoria_plano or categoria,
        "nivel": NIVEL_FORZADO.get(nombre, nivel_por_altura(zmin)),
        "ubicacion": UBICACION.get(nombre),
        "descripcion": DESCRIPCION.get(nombre),
        "vertices": volumen.vertices,
        "indices": volumen.indices,
        "piso": {"vertices": piso.vertices, "indices": piso.indices},
        "bbox": bbox,
        "centro": [round((bbox[0] + bbox[3]) / 2, 3), bbox[1], round((bbox[2] + bbox[5]) / 2, 3)],
        "posEtiqueta": [a_three(Vec3(*etiqueta, 0), centro)[i] for i in (0, 2)] if etiqueta else None,
    }


def main():
    parser = argparse.ArgumentParser(description="Genera data/edificio.json desde el DXF 3D del L3.")
    parser.add_argument("--dxf", default=str(DXF_POR_DEFECTO))
    parser.add_argument("--salida", default=str(SALIDA))
    parser.add_argument("--sin-huecos", action="store_true", help="No recortar los huecos de ventana.")
    args = parser.parse_args()

    huecos = []
    if not args.sin_huecos:
        import generar_fachada  # mismas medidas que las ventanas
        huecos = generar_fachada.huecos_ventanas()

    doc = ezdxf.readfile(args.dxf)
    solidos = list(recorrer_solidos(doc))
    solidos += [(capa, capa, caras_caja(*medidas)) for capa, *medidas in AGREGAR]
    solidos += [(capa, capa, caras_prisma(planta, z0, z1)) for capa, planta, z0, z1 in AGREGAR_PRISMAS]

    todos = [p for _, _, caras in solidos for c in caras for p in c]
    centro = ((min(p.x for p in todos) + max(p.x for p in todos)) / 2,
              (min(p.y for p in todos) + max(p.y for p in todos)) / 2)

    estructura = defaultdict(Acumulador)  # (tipo, nivel, capa) -> malla
    salidas, piezas_emergencia = [], []
    por_area, resto = {}, []
    total_caras = 0
    for nombre, capa, caras in solidos:
        if not caras or excluido(capa, caras) or nombre in AREAS_OMITIR:
            continue
        caras = desplazar(capa, caras)
        total_caras += len(caras)
        if codigo_salon(nombre) or nombre in AREAS:
            por_area.setdefault(nombre, []).extend(caras)
        else:
            resto.append((capa, caras))

    areas = sorted((construir_area(n, c, centro) for n, c in por_area.items()), key=lambda a: (a["nivel"], a["id"]))

    for capa, caras in resto:
        bb = extremos(caras)
        zmin, zmax = bb[4], bb[5]

        if capa == "A-Puertas":
            nivel = nivel_por_altura(zmin)
            emergencia = dentro_de(bb, SALIDA_EMERGENCIA)
            entrada = dentro_de(bb, PUERTA_ENTRADA) and zmin < 0.5
            tipo = "puerta_emergencia" if emergencia else "puerta_vidrio" if entrada else "puerta"
            a, b, grosor = vano_de_puerta(caras, bb)
            puerta_estilo(estructura[(tipo, nivel, capa)], estructura[("marco_puerta", nivel, capa)],
                          centro, a, b, zmin, zmax, grosor)
            if emergencia:  # letrero "SALIDA" sobre el dintel, por fuera
                salidas.append({"nivel": nivel, "posicion": list(a_three(Vec3((bb[0] + bb[1]) / 2, bb[3] + 1.0, zmin + 2.55), centro))})
            continue

        if capa == "Techo":
            tipo, nivel = "techo", "techo"
        elif capa in CAPAS_ESTRUCTURA:
            es_columna = bb[1] - bb[0] <= 1.0 and bb[3] - bb[2] <= 1.0
            tipo, nivel = ("columna" if es_columna else "muro"), CAPAS_ESTRUCTURA[capa]
        elif capa == "Escaleras de emergencia":
            piezas_emergencia.append(bb)
            tipo, nivel = "escalera", nivel_emergencia(zmax)
        elif capa == "A-Escaleras":
            tipo, nivel = "escalera", nivel_por_altura(zmax - 0.15)  # la orilla del primer piso va con él
        else:
            tipo, nivel = "otro", nivel_por_altura(zmin)

        acc = estructura[(tipo, nivel, capa)]
        for cara in caras:
            if tipo == "muro":
                if abs(normal(cara).z) > 0.95 and zmax - zmin < 0.8:  # cara de losa
                    estructura[("losa", nivel, capa)].agregar_cara(cara, centro)
                    continue
                agujeros = huecos_en_cara(cara, huecos)
                if agujeros:
                    acc.agregar_cara(cara, centro, huecos=agujeros)
                    continue
            acc.agregar_cara(cara, centro)

    # Jambas de los huecos de ventana y sus tapas.
    capa_muro = {nivel: capa for capa, nivel in CAPAS_ESTRUCTURA.items()}
    usados = [h for h in huecos if h.get("usado")]
    for h in usados:
        for cara in caras_de_hueco(h, False):
            estructura[("muro", h["nivel"], capa_muro[h["nivel"]])].agregar_cara(cara, centro)
        for cara in caras_de_hueco(h, True):
            estructura[("tapa_ventana", h["nivel"], "Ventanas")].agregar_cara(cara, centro)

    for a, b, z0, z1, grosor, nivel in PUERTAS_EXTRA:
        puerta_estilo(estructura[("puerta", nivel, "A-Puertas")], estructura[("marco_puerta", nivel, "A-Puertas")],
                      centro, a, b, z0, z1, grosor)

    for nivel, acc in barandales_emergencia(piezas_emergencia, centro).items():
        estructura[("barandal", nivel, "Escaleras de emergencia")] = acc

    objetos = [
        {"tipo": tipo, "capa": capa, "nivel": nivel, "vertices": acc.vertices, "indices": acc.indices}
        for (tipo, nivel, capa), acc in sorted(estructura.items(), key=lambda kv: str(kv[0]))
        if acc.indices
    ]

    modelo = {
        "meta": {
            "fuente": Path(args.dxf).name,
            "generado": date.today().isoformat(),
            "unidades": "m",
            "centro": [round(centro[0], 4), round(centro[1], 4)],
            "ejes": "x = este, y = arriba, z = sur (AutoCAD X, Z, -Y)",
        },
        "niveles": NIVELES,
        "areas": areas,
        "estructura": objetos,
        "salidas": salidas,
    }
    salida = Path(args.salida)
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(json.dumps(modelo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"Sólidos leídos: {len(solidos)} · caras: {total_caras}")
    if huecos:
        print(f"Huecos de ventana recortados: {len(usados)} de {len(huecos)}")
    for nivel in NIVELES:
        nombres = [a["id"] for a in areas if a["nivel"] == nivel["id"]]
        print(f"{nivel['nombre']}: {len(nombres)} áreas -> {', '.join(nombres)}")
    print(f"Estructura: {len(objetos)} grupos")
    print(f"Guardado en {salida} ({salida.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
