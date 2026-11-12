"""Genera data/fachada.json: ventanas y vidrio de la fachada del L3 (OPCIONAL).

Es una capa aparte que se dibuja POR ENCIMA de los muros de AutoCAD sin
modificarlos. Si no te gusta, basta con borrar data/fachada.json (o usar el
botón "Ventanas" de la página): el modelo vuelve a ser solo muros.

Aproxima lo que se ve en las fotos:
  * ventanas corridas con persianas en las dos fachadas largas, entre columnas
    (dejando libres las puertas de emergencia);
  * cancel de vidrio en la entrada poniente (frente a las escaleras y el chaflán).
  * El bloque de baños NO lleva vidrio: es puro muro.

Uso:
    python scripts/generar_fachada.py
"""

import json
from datetime import date
from pathlib import Path

import ezdxf
from ezdxf.math import Vec3

import generar_modelo as gm

SALIDA = gm.RAIZ / "data" / "fachada.json"

# Medidas tomadas del DXF (coordenadas AutoCAD, metros).
FACHADAS = [
    # (Y de la cara exterior, sentido hacia afuera, X inicial, X final)
    (2450.39, -1, 1307.67, 1349.97),  # fachada sur
    (2462.09, +1, 1307.60, 1349.97),  # fachada norte
]
COLUMNAS_X = [(1312.92, 1313.32), (1318.22, 1318.62), (1323.52, 1323.92), (1328.82, 1329.22),
              (1334.12, 1334.52), (1339.42, 1339.82), (1344.72, 1345.12)]
PISOS = {0: 0.0, 1: 3.57, 2: 6.97}
ANTEPECHO = 0.9   # altura de la ventana sobre el piso
DINTEL = 2.7      # altura superior de la ventana

# Huecos sin ventana en cada fachada (puertas): (Y de la fachada, X inicial, X final)
HUECOS = [(2462.09, 1329.80, 1331.45)]  # puertas de emergencia, fachada norte

# Entrada poniente: tramos de muro exterior que se cubren con cancel de vidrio.
# (punto A, punto B) en planta, con la normal hacia afuera.
ENTRADA = [
    ((1300.17, 2450.49), (1300.17, 2455.61), (-1.0, 0.0)),        # frente a las escaleras
    ((1300.57, 2456.39), (1307.60, 2462.09), (-0.629, 0.777)),   # chaflán
]
# Puerta de planta baja en el chaflán (distancia a lo largo del tramo, en m).
PUERTA_CHAFLAN = (3.5, 5.1, 2.4)  # desde, hasta, altura del dintel
BANDAS_NIVEL = {0: (0.05, 3.0), 1: (3.57, 6.57), 2: (6.97, 9.97)}


def caja(acc, centro, x0, x1, y0, y1, z0, z1):
    v = [Vec3(x0, y0, z0), Vec3(x1, y0, z0), Vec3(x1, y1, z0), Vec3(x0, y1, z0),
         Vec3(x0, y0, z1), Vec3(x1, y0, z1), Vec3(x1, y1, z1), Vec3(x0, y1, z1)]
    for cara in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        acc.agregar_cara([v[i] for i in cara], centro)


def plano(acc, centro, puntos):
    acc.agregar_cara([Vec3(p) for p in puntos], centro)


def tramos_entre_columnas(x_ini, x_fin, y, margen=0.08):
    obstaculos = list(COLUMNAS_X) + [(h0, h1) for hy, h0, h1 in HUECOS if abs(hy - y) < 0.05]
    obstaculos.sort()
    cortes = [x_ini] + [c for par in obstaculos for c in par] + [x_fin]
    for i in range(0, len(cortes), 2):
        a, b = cortes[i] + margen, cortes[i + 1] - margen
        if b - a > 0.8:
            yield a, b


def ventanas_fachada(piezas, centro):
    for y, sentido, x_ini, x_fin in FACHADAS:
        for nivel, piso in PISOS.items():
            vidrio, marco, persiana = gm.Acumulador(), gm.Acumulador(), gm.Acumulador()
            z0, z1 = piso + ANTEPECHO, piso + DINTEL
            yv = y + sentido * 0.02  # vidrio pegado al muro
            for a, b in tramos_entre_columnas(x_ini, x_fin, y):
                plano(vidrio, centro, [(a, yv, z0), (b, yv, z0), (b, yv, z1), (a, yv, z1)])
                # Marco: arriba, abajo y parteluces cada ~1.3 m.
                ym0, ym1 = sorted((y, y + sentido * 0.07))
                caja(marco, centro, a, b, ym0, ym1, z0 - 0.05, z0)
                caja(marco, centro, a, b, ym0, ym1, z1, z1 + 0.05)
                n = max(1, round((b - a) / 1.3))
                for k in range(n + 1):
                    x = a + (b - a) * k / n
                    caja(marco, centro, x - 0.025, x + 0.025, ym0, ym1, z0, z1)
                # Persianas horizontales por fuera.
                yp0, yp1 = sorted((y + sentido * 0.08, y + sentido * 0.22))
                for k in range(1, 5):
                    z = z0 + (z1 - z0) * k / 5
                    caja(persiana, centro, a, b, yp0, yp1, z - 0.015, z + 0.015)
            for tipo, acc in (("vidrio", vidrio), ("marco", marco), ("persiana", persiana)):
                if acc.indices:
                    piezas.append({"tipo": tipo, "nivel": nivel, "vertices": acc.vertices, "indices": acc.indices})


def cancel(vidrio, marco, centro, a, b, n, z0, z1):
    """Panel de vidrio con retícula entre los puntos de planta a y b."""
    a, b, n = Vec3(a[0], a[1], 0), Vec3(b[0], b[1], 0), Vec3(n[0], n[1], 0)
    va, vb = a + n * 0.02, b + n * 0.02
    plano(vidrio, centro, [(va.x, va.y, z0), (vb.x, vb.y, z0), (vb.x, vb.y, z1), (va.x, va.y, z1)])
    largo = (b - a).magnitude
    nv = max(1, round(largo / 1.25))
    nh = max(1, round((z1 - z0) / 1.0))
    for k in range(nv + 1):
        p = a + (b - a) * (k / nv) + n * 0.05
        gm.caja_orientada(marco, centro, Vec3(p.x, p.y, z0), Vec3(p.x, p.y, z1), 0.06, 0.06)
    for k in range(nh + 1):
        z = z0 + (z1 - z0) * k / nh
        pa, pb = a + n * 0.05, b + n * 0.05
        gm.caja_orientada(marco, centro, Vec3(pa.x, pa.y, z), Vec3(pb.x, pb.y, z), 0.06, 0.06)


def vidrio_entrada(piezas, centro):
    for nivel, (z0, z1) in BANDAS_NIVEL.items():
        vidrio, marco = gm.Acumulador(), gm.Acumulador()
        for i, (a, b, n) in enumerate(ENTRADA):
            es_chaflan = i == 1
            if es_chaflan and nivel == 0:
                # Deja libre la puerta de la planta baja (vidrio solo sobre el dintel).
                d0, d1, dintel = PUERTA_CHAFLAN
                av, bv = Vec3(a[0], a[1]), Vec3(b[0], b[1])
                u = (bv - av).normalize()
                p0, p1 = av + u * d0, av + u * d1
                cancel(vidrio, marco, centro, a, (p0.x, p0.y), n, z0, z1)
                cancel(vidrio, marco, centro, (p1.x, p1.y), b, n, z0, z1)
                cancel(vidrio, marco, centro, (p0.x, p0.y), (p1.x, p1.y), n, dintel, z1)
            else:
                cancel(vidrio, marco, centro, a, b, n, z0, z1)
        piezas.append({"tipo": "vidrio_torre", "nivel": nivel, "vertices": vidrio.vertices, "indices": vidrio.indices})
        piezas.append({"tipo": "marco", "nivel": nivel, "vertices": marco.vertices, "indices": marco.indices})


def huecos_ventanas():
    """Rectángulos de las ventanas para abrir el hueco en el muro de atrás.

    Lo usa generar_modelo.py: así el vidrio deja ver el interior. Cada hueco:
    a, b (extremos en planta, cara exterior), n (normal hacia afuera),
    z0, z1, nivel y grosor del muro.
    """
    huecos = []
    for y, sentido, x_ini, x_fin in FACHADAS:
        for nivel, piso in PISOS.items():
            for a, b in tramos_entre_columnas(x_ini, x_fin, y):
                huecos.append({"a": (a, y), "b": (b, y), "n": (0.0, float(sentido)),
                               "z0": piso + ANTEPECHO, "z1": piso + DINTEL, "nivel": nivel, "grosor": 0.1})
    for nivel, (z0, z1) in BANDAS_NIVEL.items():
        for i, (a, b, n) in enumerate(ENTRADA):
            grosor = 0.4 if i == 0 else 0.1  # muro poniente 0.40 m, chaflán 0.10 m
            tramos = [(a, b)]
            if i == 1 and nivel == 0:  # la puerta del chaflán ya es hueco
                d0, d1, _ = PUERTA_CHAFLAN
                av, bv = Vec3(a[0], a[1]), Vec3(b[0], b[1])
                u = (bv - av).normalize()
                p0, p1 = av + u * d0, av + u * d1
                tramos = [(a, (p0.x, p0.y)), ((p1.x, p1.y), b)]
            for ta, tb in tramos:
                huecos.append({"a": ta, "b": tb, "n": n, "z0": z0, "z1": z1, "nivel": nivel, "grosor": grosor})
    return huecos


def main():
    # Mismo origen que edificio.json (centro del dibujo completo).
    doc = ezdxf.readfile(str(gm.DXF_POR_DEFECTO))
    puntos = [p for _, _, caras in gm.recorrer_solidos(doc) for cara in caras for p in cara]
    centro = ((min(p.x for p in puntos) + max(p.x for p in puntos)) / 2,
              (min(p.y for p in puntos) + max(p.y for p in puntos)) / 2)

    piezas = []
    ventanas_fachada(piezas, centro)
    vidrio_entrada(piezas, centro)

    salida = {
        "meta": {"version": 1, "generado": date.today().isoformat(),
                 "nota": "Capa opcional de ventanas; no modifica los muros del DXF."},
        "piezas": piezas,
    }
    SALIDA.write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(piezas)} piezas · guardado en {SALIDA} ({SALIDA.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
