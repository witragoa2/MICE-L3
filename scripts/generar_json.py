"""Convierte el PDF oficial de horarios del L3 en data/horarios.json.

Normalmente no se usa solo: scripts/actualizar_semestre.py lo llama y además
actualiza los profesores y revisa los datos.

Uso:
    python scripts/generar_json.py
    python scripts/generar_json.py pdf_origen/Horarios_L3_2027-I.pdf data/horarios.json

Detecta las columnas a partir del encabezado de cada página y agrupa todas las
sesiones de un mismo grupo.
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

import pdfplumber

RAIZ = Path(__file__).resolve().parent.parent
DIR_PDF = RAIZ / "pdf_origen"
SALIDA = RAIZ / "data" / "horarios.json"

DIAS = ["LUN", "MAR", "MIE", "JUE", "VIE", "SAB"]
NOMBRES_COLUMNA = {
    "CLVMAT": "clave",
    "CLV": "clave",
    "MATERIA": "materia",
    "PROFESOR": "profesor",
    "GRUPO": "grupo",
    "TIPO": "tipo",
    "SALON": "salon",
    "CUPO": "cupo",
}
# El PDF trae "DISEÃ?O" en algunas páginas.
CORRECCIONES = {"DISEÃ?O": "DISEÑO", "DISEÃ‘O": "DISEÑO", "DISEÃ’O": "DISEÑO"}


def normalizar_columna(texto):
    if not texto:
        return ""
    limpio = re.sub(r"\s+", "", str(texto)).upper()
    limpio = limpio.replace("Á", "A").replace("É", "E").replace("Í", "I")
    limpio = limpio.replace("Ó", "O").replace("Ú", "U").replace("Ñ", "N")
    return limpio


ROMANOS = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5}


def semestre_de_nombre(ruta):
    """(año, periodo) del nombre del archivo, p. ej. 'Horarios_L3_2027-II.pdf' -> (2027, 2)."""
    m = re.search(r"(\d{4})-(IV|V|I{1,3})(?![IVX])", Path(ruta).stem, re.IGNORECASE)
    return (int(m.group(1)), ROMANOS[m.group(2).upper()]) if m else (0, 0)


def pdfs_de_horarios():
    """PDFs de pdf_origen/, del semestre más reciente al más antiguo."""
    candidatos = list(DIR_PDF.glob("*.pdf"))
    # Primero el semestre del nombre; si no lo trae, la fecha del archivo.
    return sorted(candidatos, key=lambda p: (semestre_de_nombre(p), p.stat().st_mtime), reverse=True)


def localizar_pdf():
    """Devuelve el PDF de horarios más reciente dentro de pdf_origen/."""
    candidatos = pdfs_de_horarios()
    if not candidatos:
        sys.exit("No se encontró ningún PDF en pdf_origen/")
    return candidatos[0]


def detectar_columnas(fila):
    """Mapea nombre lógico -> índice usando la fila de encabezado."""
    columnas = {}
    for indice, celda in enumerate(fila):
        clave = normalizar_columna(celda)
        clave = NOMBRES_COLUMNA.get(clave, clave)
        if clave and clave not in columnas:
            columnas[clave] = indice
    return columnas


def celda(fila, columnas, nombre):
    indice = columnas.get(nombre)
    if indice is None or indice >= len(fila):
        return ""
    valor = fila[indice]
    if valor is None:
        return ""
    texto = str(valor).strip()
    for erroneo, correcto in CORRECCIONES.items():
        texto = texto.replace(erroneo, correcto)
    return texto


def horas_de_celda(texto):
    """Convierte '12:00\\n14:00' o '07:00 09:00' en '12:00-14:00'."""
    if not texto:
        return []
    horas = re.findall(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", texto)
    horas = [f"{int(h):02d}:{m}" for h, m in horas]
    rangos = [f"{horas[i]}-{horas[i + 1]}" for i in range(0, len(horas) - 1, 2)]
    if len(horas) % 2 == 1:
        rangos.append(horas[-1])
    return rangos


def semestre_desde_pdf(pdf, ruta):
    texto = "\n".join((pagina.extract_text() or "") for pagina in pdf.pages[:2])
    coincidencia = re.search(r"SEM\s+(\d{4}-[IVX]+)", texto, re.IGNORECASE)
    if coincidencia:
        return coincidencia.group(1).upper()
    coincidencia = re.search(r"(\d{4}-[IVX]+)", ruta.stem, re.IGNORECASE)
    return coincidencia.group(1).upper() if coincidencia else ""


def leer_grupos(ruta_pdf):
    """(grupos, filas leídas, semestre) del PDF."""
    grupos = {}
    filas_leidas = 0

    with pdfplumber.open(ruta_pdf) as pdf:
        semestre = semestre_desde_pdf(pdf, ruta_pdf)
        for numero_pagina, pagina in enumerate(pdf.pages, start=1):
            tabla = pagina.extract_table()
            if not tabla:
                continue

            columnas = {}
            inicio_datos = 0
            for indice, fila in enumerate(tabla):
                candidatas = detectar_columnas(fila)
                if "grupo" in candidatas and "profesor" in candidatas:
                    columnas = candidatas
                    inicio_datos = indice + 1
                    break

            if not columnas:
                print(f"  Aviso: página {numero_pagina} sin encabezado reconocible; se omite.")
                continue

            for fila in tabla[inicio_datos:]:
                grupo = celda(fila, columnas, "grupo")
                if not re.fullmatch(r"\d{3,4}", grupo):
                    continue

                salon = celda(fila, columnas, "salon")
                if not salon:
                    continue

                materia = celda(fila, columnas, "materia")
                profesor = celda(fila, columnas, "profesor")
                clave = celda(fila, columnas, "clave")
                tipo = celda(fila, columnas, "tipo")
                cupo = celda(fila, columnas, "cupo")
                llave = (clave, materia, profesor, grupo, salon, tipo, cupo)

                if llave not in grupos:
                    grupos[llave] = {
                        "clave": clave,
                        "materia": materia,
                        "profesor": profesor,
                        "grupo": grupo,
                        "salon": salon,
                        "tipo": tipo,
                        "cupo": int(cupo) if cupo.isdigit() else None,
                        "sesiones": [],
                    }

                registro = grupos[llave]
                for dia in DIAS:
                    texto_dia = celda(fila, columnas, dia)
                    for rango in horas_de_celda(texto_dia):
                        sesion = {"dia": dia, "hora": rango}
                        if sesion not in registro["sesiones"]:
                            registro["sesiones"].append(sesion)
                filas_leidas += 1

    return list(grupos.values()), filas_leidas, semestre


def construir_horarios(ruta_pdf):
    """Lee el PDF y devuelve (datos de horarios.json, filas leídas), sin guardar."""
    grupos, filas, semestre = leer_grupos(ruta_pdf)
    grupos.sort(key=lambda g: (int(g["grupo"]), g["materia"]))
    salida = {
        "meta": {
            "semestre": semestre,
            "fuente": Path(ruta_pdf).name,
            "generado": date.today().isoformat(),
            "total_grupos": len(grupos),
            "total_sesiones": sum(len(g["sesiones"]) for g in grupos),
        },
        "grupos": grupos,
    }
    return salida, filas


def guardar_horarios(salida, ruta_salida=SALIDA):
    ruta_salida = Path(ruta_salida)
    ruta_salida.parent.mkdir(parents=True, exist_ok=True)
    ruta_salida.write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Genera data/horarios.json desde el PDF oficial.")
    parser.add_argument("pdf", nargs="?", help="Ruta del PDF de horarios")
    parser.add_argument("salida", nargs="?", help="Ruta del JSON de salida")
    args = parser.parse_args()

    ruta_pdf = Path(args.pdf).resolve() if args.pdf else localizar_pdf()
    ruta_salida = Path(args.salida).resolve() if args.salida else SALIDA
    if not ruta_pdf.exists():
        sys.exit(f"No existe el PDF: {ruta_pdf}")

    salida, filas = construir_horarios(ruta_pdf)
    guardar_horarios(salida, ruta_salida)
    print(f"Semestre: {salida['meta']['semestre'] or '(sin detectar)'}")
    print(f"Filas leídas: {filas} · grupos: {salida['meta']['total_grupos']} · sesiones: {salida['meta']['total_sesiones']}")
    print(f"Guardado en: {ruta_salida}")
    print("Para actualizar también profesores y revisar los datos usa: python scripts/actualizar_semestre.py")


if __name__ == "__main__":
    main()
