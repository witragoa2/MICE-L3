# MICE L3

**Mapa Interactivo de Clases para Estudiantes del Laboratorio L-3 “Silvia Torres Castilleja” · FES Aragón**

Página web estática (HTML, CSS, JavaScript y Three.js) que muestra el edificio del L3 en 3D y en plano 2D, y permite buscar dónde y cuándo es cada clase por grupo, profesor o materia. Los datos salen de archivos JSON que generan los scripts de Python de `scripts/`.

## Requisitos

- Python 3.10 o más reciente (probado con 3.14).
- Las bibliotecas `pdfplumber` (horarios) y `ezdxf` (modelo 3D):

```bash
pip install pdfplumber ezdxf
```

## Cada semestre: actualizar horarios y profesores

1. Copia el PDF oficial de horarios en `pdf_origen/` con el nombre `Horarios_L3_<semestre>.pdf`, por ejemplo `Horarios_L3_2027-II.pdf`. El semestre del nombre decide cuál es el más reciente.
2. Prueba primero sin guardar nada:

```bash
python scripts/actualizar_semestre.py --simular
```

3. Si el reporte se ve bien, actualiza de verdad (con `--correos` busca también los correos que falten en la página oficial del L3):

```bash
python scripts/actualizar_semestre.py --correos
```

4. Lee el reporte del final. Si dice **ERRORES**, corrígelos antes de publicar (ver abajo).
5. Sube los cambios a GitHub.

### Qué hace `actualizar_semestre.py`

| Paso | Resultado |
| --- | --- |
| Horarios | Reemplaza por completo `data/horarios.json` con los grupos del PDF nuevo. |
| PDF anteriores | Mueve los PDF de semestres pasados a `pdf_origen/anteriores/` (no los borra). |
| Profesores | `data/profesores.json` queda solo con los profesores del semestre: conserva el correo de los que siguen, agrega a los nuevos y quita a los que ya no dan clase. |
| Profesores que se van | Se guardan en `data/profesores_anteriores.json`; si regresan otro semestre, recuperan su correo solos. |
| Correos (`--correos`) | Busca en el [directorio de profesores del L3](https://sites.google.com/aragon.unam.mx/laboratorio-l3/directorio/profesores) los correos que falten. Solo asigna los que coinciden claramente con el nombre (los dos apellidos). Los dudosos se listan para revisarlos a mano. Si la página trae un correo distinto al guardado, lo avisa y conserva el guardado. |
| Revisión | Revisa los datos y muestra errores, avisos e información. |

Otras opciones:

| Comando | Para qué |
| --- | --- |
| `--solo-revisar` | Solo revisa los datos actuales, sin leer el PDF. |
| `--pdf ruta.pdf` | Usa un PDF específico. |
| `--correos URL` | Busca los correos en otra página. |
| `--sobrescribir-correos` | Con `--correos`, reemplaza también los correos que ya existen. |

### Qué revisa y cómo corregirlo

| Mensaje | Qué significa | Qué hacer |
| --- | --- | --- |
| El salón X no existe en el modelo 3D | Un grupo tiene un salón que no está en el mapa, así que no se podrá ubicar. | Si es un error del PDF, corrígelo ahí. Si es un salón nuevo o renombrado, agrégalo en `scripts/generar_modelo.py` (ver "Modelo 3D"). |
| secciones.json apunta a un área que no existe | Un grupo estudiantil o servicio quedó ligado a un área que ya no está. | Corrige el campo `area` en `data/secciones.json`. |
| Grupos sin día ni hora | El PDF no traía horario para esos grupos. | Revisa el PDF; se muestran como "Horario pendiente". |
| Horas fuera de 7:00-24:00 | Una hora no cabe en la línea del tiempo o está al revés. | Revisa el PDF. |
| Profesores sin correo | No se encontró su correo. | Escríbelo a mano en `data/profesores.json`. |

## Correos de profesores

- **Correo:** en `data/profesores.json`, campo `"correo"`. Lo que escribas a mano se conserva en las siguientes actualizaciones.
- **Página oficial de correos:** el directorio de profesores del L3 en Google Sites. Su dirección está en `URL_CORREOS`, en `scripts/correos_l3.py`; si cambia, actualízala ahí.
- **Fotos:** la página no muestra fotos de profesores (no se autorizó su uso).
- **Dónde se ve:** el correo aparece en la ficha de cada grupo y al buscar por profesor.

## Grupos estudiantiles y servicios para alumnos

Se editan a mano en `data/secciones.json`. Cada bloque tiene `area` (el id del área en el mapa, no cambiarlo), `nombre`, `descripcion`, `responsable`, `contacto`, `horario` y `redes`. Los campos vacíos se muestran como "Información pendiente". Para agregar uno, copia un bloque y cambia sus datos.

## Modelo 3D

Solo hace falta regenerarlo si cambia el edificio en AutoCAD o se renombra un área.

```bash
python scripts/generar_modelo.py
python scripts/generar_fachada.py
```

- El origen es `modelos/Laboratorio_3_Edificio_Completo_3D.dxf`; el plano 2D de referencia es `modelos/Laboratorio_3_2D.dxf`.
- Nombres, categorías (colores), puertas y ajustes del modelo están al inicio de `scripts/generar_modelo.py` (`AREAS`, `NOMBRE_ALTERNO`, `UBICACION`, `DESCRIPCION`, etc.).
- `generar_fachada.py` se corre después, porque usa el centro que guarda `generar_modelo.py`.

## Probar la página en tu computadora

```bash
python -m http.server 8765
```

Abre `http://localhost:8765`. Agrega `?guia` para abrir la guía de uso al entrar, o `?depurar` para poder revisar el visor 3D desde la consola del navegador (`window.miceVisor`).

Los datos (`data/*.json`) se recargan solos. Si cambias **JavaScript o CSS**, sube el número de versión en dos lugares para que los navegadores no usen la copia vieja:

- `index.html`: todas las apariciones de `?v=N`.
- `js/principal.js`: la constante `VERSION`.

## Estructura

| Carpeta o archivo | Contenido |
| --- | --- |
| `index.html`, `css/`, `js/` | La página. `js/principal.js` (búsquedas, línea del tiempo, pestañas) y `js/escena3d.js` (visor 3D). |
| `data/` | Datos que lee la página: `horarios.json`, `profesores.json`, `secciones.json`, `edificio.json`, `fachada.json`. |
| `img/` | Logo. |
| `pdf_origen/` | PDF de horarios del semestre actual (y `anteriores/`). |
| `modelos/` | Archivos de AutoCAD del edificio. |
| `scripts/` | Scripts de Python que generan los datos. |
