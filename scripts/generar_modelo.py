"""Convierte el modelo 3D del L3 (AutoCAD, 3DSOLID) en data/edificio.json.

Lee la geometría EXACTA de cada sólido ACIS del DXF (vértices y caras reales,
con su transformación), sin aproximaciones. Los tres pisos ya están apilados en
el DXF "Laboratorio 3 Edificio Completo - 3D", así que no se mueve nada a mano.

Uso:
    python scripts/generar_modelo.py
    python scripts/generar_modelo.py --dxf "ruta/al/archivo.dxf"

Reglas del DXF (para que el script siga funcionando al editar en AutoCAD):
  * Cada salón/área es UN sólido cuyo bloque o capa lleva su nombre
    (L-30010, JEFATURA, Grupo IDEA, ...).
  * Muros y losas van en las capas "0" (planta baja), "Primer Nivel" y
    "Segundo Nivel". Puertas en "A-Puertas", escaleras en "A-Escaleras" y
    "Escaleras de emergencia", techo en "Techo".
  * Todo con caras planas (como ahora). Las curvas no se exportan.
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
from ezdxf.math import Matrix44, Vec3
from ezdxf.math.triangulation import mapbox_earcut_3d

RAIZ = Path(__file__).resolve().parent.parent
DXF_POR_DEFECTO = RAIZ / "modelos" / "Laboratorio_3_Edificio_Completo_3D.dxf"
SALIDA = RAIZ / "data" / "edificio.json"


# ---------------------------------------------------------------------------
# Parche para ezdxf 1.4: AutoCAD guarda la matriz de transformación del sólido
# como vectores binarios y ezdxf espera texto. Sin esto, 365 de los 472 sólidos
# no se pueden leer.
# ---------------------------------------------------------------------------
_leer_transformacion_original = sab.SabDataLoader.read_transform


def _leer_transformacion(self):
    token = self.data[self.index]
    if token.tag in (Tags.STR, Tags.LITERAL_STR):
        return _leer_transformacion_original(self)
    valores = []
    for _ in range(4):  # 3 filas de rotación + traslación
        valores.extend(self.read_vec3())
    return valores


sab.SabDataLoader.read_transform = _leer_transformacion


# ---------------------------------------------------------------------------
# Niveles y clasificación
# ---------------------------------------------------------------------------
NIVELES = [
    {"id": 0, "nombre": "Planta baja", "piso": 0.0},
    {"id": 1, "nombre": "Primer piso", "piso": 3.57},
    {"id": 2, "nombre": "Segundo piso", "piso": 6.97},
]

CAPAS_ESTRUCTURA = {"0": 0, "Primer Nivel": 1, "Segundo Nivel": 2}
CAPAS_POR_ALTURA = {
    "A-Puertas": "puerta",
    "A-Escaleras": "escalera",
    "Escaleras de emergencia": "escalera",
}

# Nombre visible y categoría (mismos colores que los planos 2D del L3).
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

# Segundo nombre de cada área, tal como aparece en los planos 2D del L3.
# (nombre completo, texto corto para la etiqueta 3D, categoría según el plano o None)
NOMBRE_ALTERNO = {
    "L-30010": ("EYM", "EYM", None),
    "L-30011": ("ACE", "ACE", None),
    "L-30022": ("IASE", "IASE", "grupo"),
    "L-30024": ("AMPERIO Aprendices", "AMPERIO", "grupo"),
    "Grupo IMED": ("LIMA", "LIMA", "grupo"),
    "L-31020": ("Centro de Cómputo y Capacitación de Proyectos de Ingeniería L3", "Centro de Cómputo", None),
    "L-32015": ("3D", "3D", None),
}

# Baños: hay dos descansos en la escalera interior, a la mitad de cada subida,
# y en cada uno están los dos baños. Subiendo: mujeres a la izquierda (este),
# hombres a la derecha (poniente) — así vienen ya en el DXF.
#   P1 -> descanso entre planta baja y primer piso (z = 1.80 m)
#   P2 -> descanso entre primer y segundo piso   (z = 5.37 m)
FUSIONAR = {}

# Áreas del DXF que no se muestran en el modelo.
# SPA-1: hueco bajo la escalera interior, junto a Jefatura (no es un espacio real).
AREAS_OMITIR = {"SPA-1"}
# Se agrupan con el piso cuyos muros los rodean (para que viajen juntos al separar).
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

# Puertas que faltan en el DXF (solo está el hueco en el muro).
# (punto A, punto B, z del piso, z del techo, grosor, nivel)
PUERTAS_EXTRA = [
    ((1302.62, 2450.04), (1303.37, 2450.04), 1.80, 4.80, 0.08, 0),  # Baño Hombres P1
    ((1304.47, 2450.04), (1305.22, 2450.04), 1.80, 4.80, 0.08, 0),  # Baño Mujeres P1
    ((1302.62, 2450.04), (1303.37, 2450.04), 5.37, 8.37, 0.08, 1),  # Baño Hombres P2
    ((1304.47, 2450.04), (1305.22, 2450.04), 5.37, 8.37, 0.08, 1),  # Baño Mujeres P2
    # Club de Mecatrónica: vano en diagonal entre la punta del muro norte y el
    # chaflán del muro oriente.
    ((1324.07, 2453.65), (1324.595, 2453.11), 6.97, 9.97, 0.10, 2),
    ((1340.18, 2454.34), (1340.18, 2455.09), 6.97, 9.97, 0.10, 2),  # L32021
    ((1322.62, 2450.49), (1322.62, 2451.24), 0.00, 3.00, 0.10, 0),  # Almacén EYM/ACE -> salón ACE
]
ALTO_PUERTA = 2.1  # hoja; arriba lleva un panel fijo hasta el techo


def puerta_estilo(hoja, marco, centro, a, b, z0, z1, grosor):
    """Puerta como la de los baños: hoja + panel superior + marco de aluminio.
    a, b: extremos del vano en planta (CAD). Si el vano mide más de 1.2 m es doble."""
    a, b = Vec3(a[0], a[1], 0), Vec3(b[0], b[1], 0)
    largo = (b - a).magnitude
    if largo < 0.2:
        return
    d = (b - a).normalize()
    m = 0.04  # ancho del perfil de aluminio
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
    if largo > 1.2:                                                    # puerta doble
        pieza(marco, largo / 2 - m / 2, largo / 2 + m / 2, z0, zd, grosor)


def vano_de_puerta(caras):
    """(a, b, grosor) del vano a partir del sólido de puerta del DXF."""
    ps = [p for c in caras for p in c]
    x0, x1 = min(p.x for p in ps), max(p.x for p in ps)
    y0, y1 = min(p.y for p in ps), max(p.y for p in ps)
    if x1 - x0 <= 0.2 and (y1 - y0) > (x1 - x0):
        xc = (x0 + x1) / 2
        return (xc, y0), (xc, y1), x1 - x0
    if y1 - y0 <= 0.2:
        yc = (y0 + y1) / 2
        return (x0, yc), (x1, yc), y1 - y0
    # Puerta en diagonal: la cara vertical más ancha da la dirección y el
    # vano se centra en el grosor del sólido.
    def ancho_h(c):
        return max(math.hypot(p.x - q.x, p.y - q.y) for p in c for q in c)

    verticales = [c for c in caras if abs(normal(c).z) < 0.1]
    mejor = max(verticales, key=ancho_h)
    p, q = max(((p, q) for p in mejor for q in mejor), key=lambda pq: math.hypot(pq[0].x - pq[1].x, pq[0].y - pq[1].y))
    n = normal(mejor)
    cx, cy = sum(v.x for v in ps) / len(ps), sum(v.y for v in ps) / len(ps)
    t = (cx - p.x) * n.x + (cy - p.y) * n.y
    return (p.x + n.x * t, p.y + n.y * t), (q.x + n.x * t, q.y + n.y * t), 0.1


# ---------------------------------------------------------------------------
# Huecos de ventana: se recortan en los muros exteriores para que el vidrio
# (capa de fachada) deje ver el interior. Lo recortado se guarda como "tapa"
# para volver a cerrar el muro cuando se apagan las ventanas.
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
    """Huecos (en 3D) que caen dentro de esta cara de muro; marca los usados."""
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
        plano = sum(dist) / len(dist)
        uv = [((Vec3(p.x, p.y, 0) - a).dot(d), p.z) for p in cara]
        umin, umax = min(u for u, _ in uv), max(u for u, _ in uv)
        vmin, vmax = min(v for _, v in uv), max(v for _, v in uv)
        largo = (b - a).magnitude
        u0, u1 = max(0.0, umin + 0.01), min(largo, umax - 0.01)
        v0, v1 = max(h["z0"], vmin + 0.01), min(h["z1"], vmax - 0.01)
        if u1 - u0 < 0.1 or v1 - v0 < 0.1:
            continue
        esquinas = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        if not all(_dentro(e, uv) for e in esquinas):
            continue
        if any(u0 < u < u1 and v0 < v < v1 for u, v in uv):
            continue
        base = a + n * plano
        salida.append([Vec3((base + d * u).x, (base + d * u).y, v) for u, v in esquinas])
        h["usado"] = True
    return salida


def caras_de_hueco(h, con_frentes):
    """Caras del volumen del hueco: 4 jambas (y frente/fondo si es tapa)."""
    a, b = Vec3(h["a"][0], h["a"][1], 0), Vec3(h["b"][0], h["b"][1], 0)
    n = Vec3(h["n"][0], h["n"][1], 0)
    g, z0, z1 = h["grosor"], h["z0"], h["z1"]
    o = [Vec3(a.x, a.y, z0), Vec3(b.x, b.y, z0), Vec3(b.x, b.y, z1), Vec3(a.x, a.y, z1)]
    i = [p - n * g for p in o]
    caras = [[o[0], o[1], i[1], i[0]], [o[3], o[2], i[2], i[3]], [o[0], o[3], i[3], i[0]], [o[1], o[2], i[2], i[1]]]
    if con_frentes:
        caras += [o, i]
    return caras


HUECOS_VENTANA = []  # se llena en main() desde generar_fachada.huecos_ventanas()


def nivel_emergencia(zmax):
    """Escalera de emergencia: la mitad baja (hasta el primer piso) se muestra
    con el primer piso; la mitad alta, con el segundo. En planta baja no aparece."""
    return 1 if zmax <= 3.6 else 2

# Sólidos que se omiten: (capa, xmin, xmax, ymin, ymax, zmin desde, zmin hasta).
EXCLUIR = [
    # Descanso intermedio de la escalera de emergencia (z ≈ 2 m): en el DXF ocupa
    # todo el ancho, pero en el edificio solo existe el carril por donde la
    # escalera sigue de frente hasta el suelo. Se reemplaza por AGREGAR.
    ("Escaleras de emergencia", 1329.22, 1334.12, 2466.49, 2468.49, 1.9, 2.1),
    # Techo del bloque de baños: en el DXF se mete 0.45 m en el muro del
    # cubo de escaleras y en sus dos columnas (Y 2449.64–2450.09).
    ("Techo", 1300.17, 1307.67, 2444.79, 2450.09, 8.3, 8.4),
]
# Sólidos que se desplazan: (xmin, xmax, ymin, ymax, (dx, dy, dz)).
# Pilar de la esquina de la entrada: en el DXF quedó 0.35 m corto respecto a la
# esquina del techo (Y 2462.79); se alinea como los demás pilares de la fachada.
MOVER = [
    (1300.17, 1300.57, 2461.64, 2462.44, (0.0, 0.35, 0.0)),
]


def desplazar(capa, caras):
    if capa not in CAPAS_ESTRUCTURA:
        return caras
    ps = [p for c in caras for p in c]
    x0, x1 = min(p.x for p in ps), max(p.x for p in ps)
    y0, y1 = min(p.y for p in ps), max(p.y for p in ps)
    for mx0, mx1, my0, my1, d in MOVER:
        if abs(x0 - mx0) < 0.02 and abs(x1 - mx1) < 0.02 and abs(y0 - my0) < 0.02 and abs(y1 - my1) < 0.02:
            v = Vec3(d)
            return [[p + v for p in c] for c in caras]
    return caras


# Cajas que se agregan en lugar de lo excluido: (capa, x0, x1, y0, y1, z0, z1).
AGREGAR = [
    ("Escaleras de emergencia", 1329.22, 1331.67, 2466.49, 2468.49, 1.97, 2.17),
]
# Prismas (planta poligonal) que se agregan: (capa, [(x, y), ...], z0, z1).
AGREGAR_PRISMAS = [
    # Techo del bloque de baños en una sola pieza: llega a la cara de las dos
    # columnas y, entre ellas, hasta el muro de las puertas de los baños.
    ("Techo", [(1300.17, 2444.79), (1307.67, 2444.79), (1307.67, 2449.64), (1307.27, 2449.64),
               (1307.27, 2449.99), (1300.57, 2449.99), (1300.57, 2449.64), (1300.17, 2449.64)], 8.37, 8.77),
]


def caras_prisma(planta, z0, z1):
    abajo = [Vec3(x, y, z0) for x, y in planta]
    arriba = [Vec3(x, y, z1) for x, y in planta]
    caras = [list(reversed(abajo)), arriba]
    for i in range(len(planta)):
        j = (i + 1) % len(planta)
        caras.append([abajo[i], abajo[j], arriba[j], arriba[i]])
    return caras

# Puertas que dan a la escalera de emergencia (fachada norte).
SALIDA_EMERGENCIA = (1329.8, 1331.45, 2461.9, 2462.2)  # xmin, xmax, ymin, ymax
# Puerta principal de la entrada (chaflán poniente, planta baja): de vidrio.
PUERTA_ENTRADA = (1303.2, 1304.6, 2458.4, 2459.7)  # xmin, xmax, ymin, ymax


def excluido(capa, caras):
    ps = [p for c in caras for p in c]
    if not ps:
        return False
    x0, x1 = min(p.x for p in ps), max(p.x for p in ps)
    y0, y1 = min(p.y for p in ps), max(p.y for p in ps)
    z0 = min(p.z for p in ps)
    for c, ex0, ex1, ey0, ey1, ez0, ez1 in EXCLUIR:
        if capa == c and abs(x0 - ex0) < 0.02 and abs(x1 - ex1) < 0.02 \
                and abs(y0 - ey0) < 0.02 and abs(y1 - ey1) < 0.02 and ez0 <= z0 <= ez1:
            return True
    return False


def caras_caja(x0, x1, y0, y1, z0, z1):
    v = [Vec3(x0, y0, z0), Vec3(x1, y0, z0), Vec3(x1, y1, z0), Vec3(x0, y1, z0),
         Vec3(x0, y0, z1), Vec3(x1, y0, z1), Vec3(x1, y1, z1), Vec3(x0, y1, z1)]
    return [[v[i] for i in c] for c in
            ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))]


def caja_orientada(acc, centro, p, q, ancho, alto):
    """Barra recta de sección ancho×alto entre los puntos p y q (CAD)."""
    p, q = Vec3(p), Vec3(q)
    d = (q - p)
    if d.magnitude < 1e-6:
        return
    d = d.normalize()
    u = Vec3(0, 0, 1).cross(d)
    if u.magnitude < 1e-6:  # barra vertical
        u = Vec3(1, 0, 0)
    u = u.normalize() * (ancho / 2)
    v = d.cross(u).normalize() * (alto / 2)
    esq = [p - u - v, p + u - v, p + u + v, p - u + v, q - u - v, q + u - v, q + u + v, q - u + v]
    for cara in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        acc.agregar_cara([esq[i] for i in cara], centro)


def barandales_emergencia(piezas, centro):
    """Genera barandales para la escalera de emergencia a partir de sus sólidos.

    piezas: lista de bbox (x0, x1, y0, y1, z0, z1) de la capa "Escaleras de emergencia".
    Devuelve {nivel: Acumulador}.
    """
    ALTO, ALTO_MEDIO, POSTE, TUBO = 0.95, 0.45, 0.045, 0.05
    salida = defaultdict(Acumulador)
    escalones = [b for b in piezas if (b[3] - b[2]) <= 0.35]
    descansos = [b for b in piezas if (b[3] - b[2]) > 1.2 and b[5] > 0.3]

    # --- tramos: escalones contiguos con el mismo ancho y alturas seguidas
    escalones.sort(key=lambda b: (round(b[0], 2), round(b[1], 2), b[2]))
    tramos = []
    for b in escalones:
        for t in tramos:
            u = t[-1]
            if abs(u[0] - b[0]) < 0.02 and abs(u[1] - b[1]) < 0.02 \
                    and abs(u[3] - b[2]) < 0.05 and 0.05 < abs(u[5] - b[5]) < 0.26:
                t.append(b)
                break
        else:
            tramos.append([b])
    tramos = [t for t in tramos if len(t) >= 3]

    for t in tramos:
        nivel = nivel_emergencia(max(b[5] for b in t))
        acc = salida[nivel]
        primero, ultimo = t[0], t[-1]
        for x in (primero[0] + 0.06, primero[1] - 0.06):
            a = Vec3(x, primero[2], primero[5])
            b = Vec3(x, ultimo[3], ultimo[5])
            caja_orientada(acc, centro, a + Vec3(0, 0, ALTO), b + Vec3(0, 0, ALTO), TUBO, TUBO)
            caja_orientada(acc, centro, a + Vec3(0, 0, ALTO_MEDIO), b + Vec3(0, 0, ALTO_MEDIO), TUBO * 0.7, TUBO * 0.7)
            for i in range(0, len(t), 3):
                e = t[i]
                base = Vec3(x, (e[2] + e[3]) / 2, e[5])
                caja_orientada(acc, centro, base, base + Vec3(0, 0, ALTO), POSTE, POSTE)

    # --- descansos: barandal en los bordes libres
    def ocupado_en_borde(desc, eje, valor):
        """Intervalos del borde que tocan un tramo (por donde se sube/baja)."""
        intervalos = []
        for t in tramos:
            for e in (t[0], t[-1]):
                if eje == "y" and (abs(e[2] - valor) < 0.06 or abs(e[3] - valor) < 0.06) \
                        and abs(e[5] - desc[5]) < 0.3:
                    intervalos.append((e[0], e[1]))
        return intervalos

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
        nivel = nivel_emergencia(d[5])
        acc = salida[nivel]
        junto_al_edificio = abs(y0 - 2462.09) < 0.06
        bordes = []
        for yb in ((y1,) if junto_al_edificio else (y0, y1)):
            for s0, s1 in restar(x0, x1, ocupado_en_borde(d, "y", yb)):
                off = -0.06 if yb == y1 else 0.06
                bordes.append((Vec3(s0, yb + off, z), Vec3(s1, yb + off, z)))
        for xb, off in ((x0, 0.06), (x1, -0.06)):
            bordes.append((Vec3(xb + off, y0 + (0.1 if junto_al_edificio else 0), z), Vec3(xb + off, y1, z)))
        for a, b in bordes:
            caja_orientada(acc, centro, a + Vec3(0, 0, ALTO), b + Vec3(0, 0, ALTO), TUBO, TUBO)
            caja_orientada(acc, centro, a + Vec3(0, 0, ALTO_MEDIO), b + Vec3(0, 0, ALTO_MEDIO), TUBO * 0.7, TUBO * 0.7)
            n = max(1, round((b - a).magnitude / 1.1))
            for k in range(n + 1):
                pos = a + (b - a) * (k / n)
                caja_orientada(acc, centro, pos, pos + Vec3(0, 0, ALTO), POSTE, POSTE)
    return salida


def codigo_salon(nombre):
    if nombre in ALIAS_CODIGO:
        return ALIAS_CODIGO[nombre]
    m = re.fullmatch(r"L-?(\d{5})", nombre.strip(), re.IGNORECASE)
    return f"L{m.group(1)}" if m else None


def nivel_por_altura(zmin):
    if zmin < 3.4:
        return 0
    if zmin < 6.8:
        return 1
    return 2


# ---------------------------------------------------------------------------
# Geometría
# ---------------------------------------------------------------------------
def caras_de_solido(entidad, matriz=None):
    """Devuelve las caras planas (lista de polígonos Vec3) del sólido."""
    caras = []
    for cuerpo in acis.load_dxf(entidad):
        for malla in acis.mesh_from_body(cuerpo):
            vertices = malla.vertices
            if matriz is not None:
                vertices = list(matriz.transform_vertices(vertices))
            for cara in malla.faces:
                caras.append([Vec3(vertices[i]) for i in cara])
    return caras


def recorrer_solidos(doc):
    """Genera (nombre, capa, caras) para cada 3DSOLID, explotando bloques."""
    vistos = set()
    for entidad in doc.modelspace():
        tipo = entidad.dxftype()
        if tipo == "3DSOLID":
            yield entidad.dxf.layer, entidad.dxf.layer, caras_de_solido(entidad)
        elif tipo == "INSERT":
            nombre = entidad.dxf.name
            matriz = entidad.matrix44()
            clave = (nombre, tuple(round(v, 3) for v in matriz))
            if clave in vistos:  # p. ej. L-32011 insertado dos veces
                continue
            vistos.add(clave)
            for sub in doc.blocks[nombre]:
                if sub.dxftype() == "3DSOLID":
                    capa = sub.dxf.layer if sub.dxf.layer != "0" else entidad.dxf.layer
                    yield nombre, capa, caras_de_solido(sub, matriz)


def a_three(p, centro):
    """AutoCAD (X este, Y norte, Z arriba) -> Three.js (x, y arriba, z sur)."""
    return (round(p.x - centro[0], 3), round(p.z, 3), round(-(p.y - centro[1]), 3))


class Acumulador:
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
                triangulos = [(poligono[0], poligono[i], poligono[i + 1])
                              for i in range(1, len(poligono) - 1)]
        for tri in triangulos:
            base = len(self.vertices) // 3
            for p in tri:
                x, y, z = a_three(p, centro)
                y = round(y + elevar, 3)
                self.vertices.extend((x, y, z))
                for i, v in enumerate((x, y, z)):
                    self.min[i] = min(self.min[i], v)
                    self.max[i] = max(self.max[i], v)
            self.indices.extend((base, base + 1, base + 2))

    def bbox(self):
        return [round(v, 3) for v in self.min + self.max]


def normal(poligono):
    n = Vec3()
    for i, a in enumerate(poligono):
        b = poligono[(i + 1) % len(poligono)]
        n += Vec3((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y))
    return n.normalize() if n.magnitude > 1e-12 else n


# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Genera data/edificio.json desde el DXF 3D del L3.")
    parser.add_argument("--dxf", default=str(DXF_POR_DEFECTO))
    parser.add_argument("--salida", default=str(SALIDA))
    parser.add_argument("--sin-huecos", action="store_true",
                        help="No recortar los huecos de ventana (muros macizos, como el DXF).")
    args = parser.parse_args()

    global HUECOS_VENTANA
    if args.sin_huecos:
        HUECOS_VENTANA = []
    else:
        import generar_fachada  # mismas medidas que las ventanas
        HUECOS_VENTANA = generar_fachada.huecos_ventanas()

    doc = ezdxf.readfile(args.dxf)
    solidos = list(recorrer_solidos(doc))
    solidos += [(capa, capa, caras_caja(*medidas)) for capa, *medidas in AGREGAR]
    solidos += [(capa, capa, caras_prisma(planta, z0, z1)) for capa, planta, z0, z1 in AGREGAR_PRISMAS]

    todos = [p for _, _, caras in solidos for cara in caras for p in cara]
    xmin, xmax = min(p.x for p in todos), max(p.x for p in todos)
    ymin, ymax = min(p.y for p in todos), max(p.y for p in todos)
    centro = ((xmin + xmax) / 2, (ymin + ymax) / 2)

    estructura = defaultdict(Acumulador)  # (tipo, nivel, capa) -> geometría
    areas = []
    salidas = []
    piezas_emergencia = []
    total_caras = 0

    # Primero se juntan los sólidos de cada área (p. ej. los dos medios baños).
    por_area = {}
    resto = []
    for nombre, capa, caras in solidos:
        if not caras or excluido(capa, caras):
            continue
        caras = desplazar(capa, caras)
        total_caras += len(caras)
        nombre = FUSIONAR.get(nombre, nombre)
        if nombre in AREAS_OMITIR:
            continue
        if codigo_salon(nombre) or nombre in AREAS:
            por_area.setdefault(nombre, []).extend(caras)
        else:
            resto.append((nombre, capa, caras))

    for nombre, caras in por_area.items():
        zmin = min(p.z for cara in caras for p in cara)
        codigo = codigo_salon(nombre)
        if True:
            visible, categoria = AREAS.get(nombre, (codigo, "salon"))
            if codigo and nombre not in AREAS:
                categoria = "salon"
            alias, alias_corto, categoria_plano = NOMBRE_ALTERNO.get(nombre, (None, None, None))
            if categoria_plano:
                categoria = categoria_plano
            partes = [codigo, visible if visible != codigo else None, alias_corto]
            etiqueta = " · ".join(p for p in partes if p)
            nivel = NIVEL_FORZADO.get(nombre, nivel_por_altura(zmin))
            volumen = Acumulador()
            piso = Acumulador()
            for cara in caras:
                volumen.agregar_cara(cara, centro)
                n = normal(cara)
                if abs(n.z) > 0.95 and all(abs(p.z - zmin) < 0.01 for p in cara):
                    piso.agregar_cara(cara, centro, elevar=0.02)
            bbox = volumen.bbox()
            areas.append({
                "id": codigo or nombre,
                "codigo": codigo,
                "nombre": visible,
                "alias": alias,
                "etiqueta": etiqueta,
                "capa": nombre,
                "tipo": categoria,
                "nivel": nivel,
                "ubicacion": UBICACION.get(nombre),
                "descripcion": DESCRIPCION.get(nombre),
                "vertices": volumen.vertices,
                "indices": volumen.indices,
                "piso": {"vertices": piso.vertices, "indices": piso.indices},
                "bbox": bbox,
                "centro": [round((bbox[0] + bbox[3]) / 2, 3), round(bbox[1], 3),
                           round((bbox[2] + bbox[5]) / 2, 3)],
            })

    for nombre, capa, caras in resto:
        zmin = min(p.z for cara in caras for p in cara)
        zmax = max(p.z for cara in caras for p in cara)
        xs = [p.x for cara in caras for p in cara]
        ys = [p.y for cara in caras for p in cara]
        bb = (min(xs), max(xs), min(ys), max(ys), zmin, zmax)

        if capa == "Escaleras de emergencia":
            piezas_emergencia.append(bb)

        if capa == "A-Puertas":
            # Todas las puertas con el mismo estilo (hoja + panel + marco).
            nivel = nivel_por_altura(zmin)
            sx0, sx1, sy0, sy1 = SALIDA_EMERGENCIA
            emergencia = bb[0] >= sx0 and bb[1] <= sx1 and bb[2] >= sy0 and bb[3] <= sy1
            ex0, ex1, ey0, ey1 = PUERTA_ENTRADA
            entrada = bb[0] >= ex0 and bb[1] <= ex1 and bb[2] >= ey0 and bb[3] <= ey1 and zmin < 0.5
            tipo_puerta = "puerta_emergencia" if emergencia else "puerta_vidrio" if entrada else "puerta"
            a, b, grosor = vano_de_puerta(caras)
            puerta_estilo(estructura[(tipo_puerta, nivel, capa)],
                          estructura[("marco_puerta", nivel, capa)], centro, a, b, zmin, zmax, grosor)
            if emergencia:
                # Letrero "SALIDA" un poco por fuera de la puerta, sobre el dintel.
                x, y, z = a_three(Vec3((bb[0] + bb[1]) / 2, bb[3] + 0.3, zmin + 2.55), centro)
                salidas.append({"nivel": nivel, "posicion": [x, y, z]})
            continue

        if capa == "Techo":
            tipo, nivel = "techo", "techo"
        elif capa in CAPAS_ESTRUCTURA:
            es_columna = (bb[1] - bb[0]) <= 1.0 and (bb[3] - bb[2]) <= 1.0
            tipo, nivel = ("columna" if es_columna else "muro"), CAPAS_ESTRUCTURA[capa]
        elif capa == "Escaleras de emergencia":
            tipo, nivel = "escalera", nivel_emergencia(zmax)
        elif capa == "A-Escaleras":
            # Por la parte alta: así la orilla del primer piso (z 3.37–3.57)
            # ya no aparece en planta baja.
            tipo, nivel = "escalera", nivel_por_altura(zmax - 0.15)
        elif capa in CAPAS_POR_ALTURA:
            tipo, nivel = CAPAS_POR_ALTURA[capa], nivel_por_altura(zmin)
        else:
            tipo, nivel = "otro", nivel_por_altura(zmin)

        acumulador = estructura[(tipo, nivel, capa)]
        for cara in caras:
            # Losas (caras horizontales grandes) se separan de los muros para
            # poder darles otro color.
            if tipo == "muro":
                n = normal(cara)
                if abs(n.z) > 0.95 and (zmax - zmin) < 0.8:
                    estructura[("losa", nivel, capa)].agregar_cara(cara, centro)
                    continue
                if HUECOS_VENTANA:
                    agujeros = huecos_en_cara(cara, HUECOS_VENTANA)
                    if agujeros:
                        acumulador.agregar_cara(cara, centro, huecos=agujeros)
                        continue
            acumulador.agregar_cara(cara, centro)

    # Jambas de cada hueco de ventana recortado + su tapa (para "Ventanas: no").
    for h in HUECOS_VENTANA:
        if not h.get("usado"):
            continue
        capa_muro = {0: "0", 1: "Primer Nivel", 2: "Segundo Nivel"}[h["nivel"]]
        for cara in caras_de_hueco(h, con_frentes=False):
            estructura[("muro", h["nivel"], capa_muro)].agregar_cara(cara, centro)
        for cara in caras_de_hueco(h, con_frentes=True):
            estructura[("tapa_ventana", h["nivel"], "Ventanas")].agregar_cara(cara, centro)
    usados = sum(1 for h in HUECOS_VENTANA if h.get("usado"))
    if HUECOS_VENTANA:
        print(f"Huecos de ventana recortados: {usados} de {len(HUECOS_VENTANA)}")

    # Puertas que no vienen en el DXF (baños, club de mecatrónica).
    for a, b, z0, z1, grosor, nivel in PUERTAS_EXTRA:
        puerta_estilo(estructura[("puerta", nivel, "A-Puertas")], estructura[("marco_puerta", nivel, "A-Puertas")],
                      centro, a, b, z0, z1, grosor)

    for nivel, acc in barandales_emergencia(piezas_emergencia, centro).items():
        estructura[("barandal", nivel, "Escaleras de emergencia")] = acc

    objetos = []
    for (tipo, nivel, capa), acc in sorted(estructura.items(), key=lambda kv: str(kv[0])):
        if not acc.indices:
            continue
        objetos.append({
            "id": f"{tipo}-{nivel}-{capa}",
            "tipo": tipo,
            "capa": capa,
            "nivel": nivel,
            "vertices": acc.vertices,
            "indices": acc.indices,
            "bbox": acc.bbox(),
        })

    areas.sort(key=lambda a: (a["nivel"], a["id"]))
    limites_min = [min(o["bbox"][i] for o in objetos + areas) for i in range(3)]
    limites_max = [max(o["bbox"][i + 3] for o in objetos + areas) for i in range(3)]

    modelo = {
        "meta": {
            "version": 2,
            "fuente": Path(args.dxf).name,
            "generado": date.today().isoformat(),
            "unidades": "m",
            "caras": total_caras,
            "ejes": "x = este, y = arriba, z = sur (AutoCAD X, Z, -Y)",
        },
        "limites": {"min": limites_min, "max": limites_max},
        "niveles": NIVELES,
        "areas": areas,
        "estructura": objetos,
        "salidas": salidas,
    }

    salida = Path(args.salida)
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(json.dumps(modelo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"Sólidos leídos: {len(solidos)} · caras: {total_caras}")
    for nivel in NIVELES:
        nombres = [a["id"] for a in areas if a["nivel"] == nivel["id"]]
        print(f"{nivel['nombre']}: {len(nombres)} áreas -> {', '.join(nombres)}")
    print(f"Estructura: {len(objetos)} grupos")
    print(f"Guardado en {salida} ({salida.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
