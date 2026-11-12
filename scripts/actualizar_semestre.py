"""Actualiza MICE L3 con el PDF de horarios de un semestre nuevo.

Pasos (todos automáticos):
  1. Toma el PDF del semestre más reciente de pdf_origen/ y REEMPLAZA data/horarios.json.
     Los PDF de semestres anteriores se mueven a pdf_origen/anteriores/.
  2. Deja en data/profesores.json solo a los profesores de este semestre: conserva
     el correo y la foto de los que siguen, agrega a los nuevos y quita a los que ya
     no dan clase. Los quitados se guardan en data/profesores_anteriores.json para
     recuperar su correo y foto si regresan otro semestre.
  3. Con --correos, busca en la página oficial del L3 los correos que falten.
  4. Revisa los datos y muestra un reporte (salones que no existen en el modelo, etc.).

Uso:
    python scripts/actualizar_semestre.py                 actualiza todo
    python scripts/actualizar_semestre.py --simular       muestra qué cambiaría, sin guardar
    python scripts/actualizar_semestre.py --correos       además busca correos (URL guardada)
    python scripts/actualizar_semestre.py --correos URL   busca correos en otra página
    python scripts/actualizar_semestre.py --solo-revisar  solo revisa los datos actuales
"""

import argparse
import json
import shutil
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import correos_l3  # noqa: E402
import generar_json  # noqa: E402

RAIZ = generar_json.RAIZ
DATOS = RAIZ / "data"
HORARIOS = DATOS / "horarios.json"
PROFESORES = DATOS / "profesores.json"
ANTERIORES = DATOS / "profesores_anteriores.json"
EDIFICIO = DATOS / "edificio.json"
SECCIONES = DATOS / "secciones.json"
DIR_FOTOS = RAIZ / "img" / "profesores"
EXTENSIONES_FOTO = (".jpg", ".jpeg", ".png", ".webp")
HORA_MIN, HORA_MAX = 7 * 60, 24 * 60  # rango de la línea del tiempo de la página
NOTA_PROFESORES = (
    "Se genera con scripts/actualizar_semestre.py: solo los profesores del semestre. "
    "correo y foto se pueden editar a mano y se conservan al actualizar. "
    "Sin foto se usa la genérica; sin correo no se muestra."
)


# ---------- utilidades ----------
def leer_json(ruta, defecto=None):
    return json.loads(ruta.read_text(encoding="utf-8")) if ruta.exists() else defecto


def guardar_json(ruta, datos, compacto=False):
    texto = json.dumps(datos, ensure_ascii=False, separators=(",", ":")) if compacto else json.dumps(datos, ensure_ascii=False, indent=2)
    ruta.write_text(texto + ("" if compacto else "\n"), encoding="utf-8")


def clave(nombre):
    return " ".join(correos_l3.plano(nombre))


def nombre_archivo(nombre):
    """'GARZÓN ACEVES MAX' -> 'garzon_aceves_max' (nombre esperado de su foto)."""
    return "_".join(correos_l3.plano(nombre)).lower()


def foto_de(nombre, previa):
    """Foto existente: la que ya tenía o img/profesores/<nombre>.jpg|png|webp."""
    if previa and (RAIZ / previa).exists():
        return previa
    for ext in EXTENSIONES_FOTO:
        ruta = DIR_FOTOS / f"{nombre_archivo(nombre)}{ext}"
        if ruta.exists():
            return ruta.relative_to(RAIZ).as_posix()
    return None


def minutos(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


# ---------- profesores ----------
def sincronizar_profesores(nombres_semestre, actuales, anteriores):
    """Lista nueva de profesores del semestre + cambios para el reporte."""
    conocidos = {clave(p["nombre"]): p for p in anteriores}
    conocidos.update({clave(p["nombre"]): p for p in actuales})
    claves_actuales = {clave(p["nombre"]) for p in actuales}
    claves_anteriores = {clave(p["nombre"]) for p in anteriores}

    profesores, agregados, recuperados = [], [], []
    for nombre in sorted(nombres_semestre, key=clave):
        k = clave(nombre)
        previo = conocidos.get(k)
        profesores.append({
            "nombre": nombre,
            "correo": (previo or {}).get("correo") or None,
            "foto": foto_de(nombre, (previo or {}).get("foto")),
        })
        if k not in claves_actuales:
            (recuperados if k in claves_anteriores else agregados).append(nombre)

    claves_semestre = {clave(n) for n in nombres_semestre}
    quitados = [p for p in actuales if clave(p["nombre"]) not in claves_semestre]
    historial = {clave(p["nombre"]): p for p in anteriores if clave(p["nombre"]) not in claves_semestre}
    historial.update({clave(p["nombre"]): p for p in quitados if p.get("correo") or p.get("foto")})
    anteriores_nuevos = sorted(historial.values(), key=lambda p: clave(p["nombre"]))
    return profesores, anteriores_nuevos, {"agregados": agregados, "recuperados": recuperados, "quitados": [p["nombre"] for p in quitados]}


def completar_correos(profesores, url, sobrescribir):
    """Llena los correos que faltan; devuelve (nuevos, distintos, dudosos).

    distintos = profesores cuyo correo guardado no coincide con el de la página
    (solo se reemplaza con --sobrescribir-correos).
    """
    encontrados, dudosos = correos_l3.buscar_correos([p["nombre"] for p in profesores], url)
    nuevos, distintos = {}, []
    for p in profesores:
        correo = encontrados.get(p["nombre"])
        if not correo or correo == (p["correo"] or "").lower():
            continue
        if not p["correo"]:
            nuevos[p["nombre"]] = p["correo"] = correo
        else:
            distintos.append((p["nombre"], p["correo"], correo))
            if sobrescribir:
                p["correo"] = correo
    return nuevos, distintos, dudosos


# ---------- revisión ----------
def revisar(horarios, profesores, edificio, secciones):
    """(errores, avisos, información) de los datos."""
    errores, avisos, info = [], [], []
    grupos = horarios.get("grupos", [])
    areas = edificio.get("areas", []) if edificio else []
    codigos = {a["codigo"] for a in areas if a.get("codigo")}
    ids = {a["id"] for a in areas}

    if not grupos:
        errores.append("El PDF no produjo ningún grupo: revisa que sea el horario del L3.")

    por_salon = {}
    for g in grupos:
        por_salon.setdefault(g["salon"], []).append(g["grupo"])
    for salon, lista in sorted(por_salon.items()):
        if salon not in codigos and salon not in ids:
            errores.append(f"El salón {salon} no existe en el modelo 3D (grupos {', '.join(lista[:8])}{'…' if len(lista) > 8 else ''}). "
                           "No se podrá ubicar en el mapa: corrige el PDF o agrega el salón a scripts/generar_modelo.py.")

    sin_horario = [g["grupo"] for g in grupos if not g["sesiones"]]
    if sin_horario:
        avisos.append(f"{len(sin_horario)} grupos sin día ni hora: {', '.join(sin_horario[:10])}")

    fuera = sorted({g["grupo"] for g in grupos for s in g["sesiones"]
                    if "-" in s["hora"] and not (HORA_MIN <= minutos(s["hora"].split("-")[0]) < minutos(s["hora"].split("-")[1]) <= HORA_MAX)})
    if fuera:
        avisos.append(f"Grupos con horas fuera de 7:00-24:00 o al revés: {', '.join(fuera[:10])}")

    vistos = {}
    for g in grupos:
        vistos.setdefault(g["grupo"], set()).add((g["materia"], g["profesor"]))
    repetidos = sorted(k for k, v in vistos.items() if len(v) > 1)
    if repetidos:
        avisos.append(f"Grupos con más de una materia o profesor: {', '.join(repetidos[:10])}")

    sin_profesor = sorted({g["grupo"] for g in grupos if not g["profesor"].strip()})
    if sin_profesor:
        avisos.append(f"Grupos sin profesor: {', '.join(sin_profesor[:10])}")

    sin_correo = [p["nombre"] for p in profesores if not p["correo"]]
    if sin_correo:
        avisos.append(f"{len(sin_correo)} de {len(profesores)} profesores sin correo: {', '.join(sin_correo[:6])}{'…' if len(sin_correo) > 6 else ''}")
    for p in profesores:
        if p["correo"] and not correos_l3.PATRON_CORREO.fullmatch(p["correo"]):
            avisos.append(f"Correo con formato raro: {p['nombre']} -> {p['correo']}")

    for tipo in ("grupos", "servicios"):
        for s in (secciones or {}).get(tipo, []):
            if s.get("area") not in ids:
                errores.append(f"secciones.json: '{s.get('nombre')}' apunta al área '{s.get('area')}', que no existe en el modelo.")

    con_foto = sum(1 for p in profesores if p["foto"])
    info.append(f"{con_foto} de {len(profesores)} profesores con foto (img/profesores/<apellidos_nombre>.jpg)")
    vacios = sorted(c for c in codigos if c not in por_salon)
    if vacios:
        info.append(f"Salones sin clases este semestre: {', '.join(vacios)}")
    return errores, avisos, info


def imprimir_lista(titulo, filas):
    if filas:
        print(f"\n{titulo}")
        for f in filas:
            print(f"  - {f}")


# ---------- principal ----------
def main():
    parser = argparse.ArgumentParser(description="Actualiza horarios y profesores del semestre y revisa los datos.")
    parser.add_argument("--pdf", help="PDF de horarios (por defecto, el semestre más reciente de pdf_origen/)")
    parser.add_argument("--correos", nargs="?", const="", metavar="URL",
                        help="Busca los correos que falten en la página oficial del L3")
    parser.add_argument("--sobrescribir-correos", action="store_true",
                        help="Con --correos, reemplaza también los correos que ya existen")
    parser.add_argument("--simular", action="store_true", help="Muestra los cambios sin guardar nada")
    parser.add_argument("--solo-revisar", action="store_true", help="Solo revisa los datos actuales")
    args = parser.parse_args()

    edificio = leer_json(EDIFICIO, {})
    secciones = leer_json(SECCIONES, {})
    actuales = leer_json(PROFESORES, {}).get("profesores", [])
    anteriores = leer_json(ANTERIORES, {}).get("profesores", [])

    if args.solo_revisar:
        horarios = leer_json(HORARIOS, {})
        profesores = actuales
        print(f"Revisando datos actuales · semestre {horarios.get('meta', {}).get('semestre', '?')}")
    else:
        ruta_pdf = Path(args.pdf).resolve() if args.pdf else generar_json.localizar_pdf()
        if not ruta_pdf.exists():
            sys.exit(f"No existe el PDF: {ruta_pdf}")
        semestre_previo = leer_json(HORARIOS, {}).get("meta", {}).get("semestre", "")
        print(f"Leyendo {ruta_pdf.name}…")
        horarios, filas = generar_json.construir_horarios(ruta_pdf)
        m = horarios["meta"]
        print(f"Semestre {m['semestre'] or '(sin detectar)'}"
              f"{f' (antes {semestre_previo})' if semestre_previo and semestre_previo != m['semestre'] else ''}"
              f" · {m['total_grupos']} grupos · {m['total_sesiones']} sesiones")

        nombres = {g["profesor"].strip() for g in horarios["grupos"] if g["profesor"].strip()}
        profesores, anteriores_nuevos, cambios = sincronizar_profesores(nombres, actuales, anteriores)
        print(f"Profesores del semestre: {len(profesores)}"
              f" · nuevos {len(cambios['agregados'])} · regresan {len(cambios['recuperados'])} · ya no dan clase {len(cambios['quitados'])}")
        imprimir_lista("Profesores nuevos:", cambios["agregados"])
        imprimir_lista("Profesores que regresan (se recuperó su correo/foto):", cambios["recuperados"])
        imprimir_lista("Profesores que ya no dan clase:", cambios["quitados"])

        if args.correos is not None:
            try:
                nuevos, distintos, dudosos = completar_correos(profesores, args.correos or None, args.sobrescribir_correos)
                print(f"\nCorreos nuevos desde la página oficial: {len(nuevos)}")
                for nombre, correo in sorted(nuevos.items()):
                    print(f"  - {nombre}: {correo}")
                accion = "se reemplazaron" if args.sobrescribir_correos else "se conserva el guardado; --sobrescribir-correos los cambia"
                imprimir_lista(f"Correos distintos en la página ({accion}):",
                               [f"{n}: guardado {viejo} · página {nuevo}" for n, viejo, nuevo in distintos])
                imprimir_lista("Correos dudosos (revísalos a mano):", [f"{c} ({motivo})" for c, motivo in dudosos])
            except Exception as error:  # sin internet, página caída, etc.
                print(f"\nNo se pudieron buscar los correos: {error}")

        if not args.simular:
            generar_json.guardar_horarios(horarios, HORARIOS)
            guardar_json(PROFESORES, {
                "meta": {"semestre": m["semestre"], "actualizado": date.today().isoformat(),
                         "total": len(profesores), "nota": NOTA_PROFESORES},
                "profesores": profesores,
            })
            guardar_json(ANTERIORES, {
                "meta": {"nota": "Profesores de semestres anteriores; no lo usa la página. "
                                 "Sirve para recuperar su correo y foto si regresan."},
                "profesores": anteriores_nuevos,
            })
            archivar_pdfs_anteriores(ruta_pdf)

    errores, avisos, info = revisar(horarios, profesores, edificio, secciones)
    imprimir_lista("ERRORES (hay que corregirlos):", errores)
    imprimir_lista("Avisos:", avisos)
    imprimir_lista("Información:", info)

    if args.simular:
        print("\nSimulación: no se guardó ningún cambio.")
    elif not args.solo_revisar:
        print("\nGuardado: data/horarios.json, data/profesores.json y data/profesores_anteriores.json")
    print("Revisión:", "con errores" if errores else "sin errores")
    sys.exit(1 if errores else 0)


def archivar_pdfs_anteriores(actual):
    """Mueve los PDF de otros semestres a pdf_origen/anteriores/ (no se borran)."""
    destino = generar_json.DIR_PDF / "anteriores"
    for pdf in generar_json.pdfs_de_horarios():
        if pdf.resolve() != actual.resolve() and generar_json.semestre_de_nombre(pdf) < generar_json.semestre_de_nombre(actual):
            destino.mkdir(exist_ok=True)
            shutil.move(str(pdf), destino / pdf.name)
            print(f"PDF anterior movido a pdf_origen/anteriores/: {pdf.name}")


if __name__ == "__main__":
    main()
