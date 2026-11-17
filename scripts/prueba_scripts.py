"""Pruebas rápidas de los scripts del semestre. Uso: python scripts/prueba_scripts.py

Si algo falla, muestra cuál comprobación y se detiene; si todo está bien, dice "Todo bien".
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from actualizar_semestre import sincronizar_profesores  # noqa: E402
from correos_l3 import asignar_correos, parecidas  # noqa: E402
from generar_json import horas_de_celda, semestre_de_nombre  # noqa: E402

# Semestre en el nombre del PDF; sin él da (0, 0) y actualizar_semestre.py se detiene.
assert semestre_de_nombre("Horarios_L3_2028-I.pdf") == (2028, 1)
assert semestre_de_nombre("Horarios_L3_2028-II (1).pdf") == (2028, 2)
assert semestre_de_nombre("Horarios L3 2028-1.pdf") == (0, 0)
assert semestre_de_nombre("horario.pdf") == (0, 0)

# Horas de una celda del PDF.
assert horas_de_celda("12:00\n14:00") == ["12:00-14:00"]
assert horas_de_celda("7:00 9:00 15:00 17:00") == ["07:00-09:00", "15:00-17:00"]
assert horas_de_celda("") == []

# Apellidos con una letra distinta sí; palabras distintas no.
assert parecidas("GONZALEZ", "GONZALES") and parecidas("DIAZ", "DIAS")
assert not parecidas("RUIZ", "RUBIO")

# Cada correo va con su profesor, aunque compartan un apellido.
texto = ("HERNANDEZ HERNANDEZ JUAN\njuan.hh@aragon.unam.mx\n"
         "HERNANDEZ LOPEZ MARIA mhl@aragon.unam.mx\n"
         "RAMIREZ FLORES ANTONIO arf@aragon.unam.mx\n")
asignados, dudosos = asignar_correos(texto, ["HERNANDEZ HERNANDEZ JUAN", "HERNANDEZ LOPEZ MARIA",
                                             "RAMIREZ FLORES ANTONIO", "VEGA RAMIREZ ALEJANDRO ANTONIO"])
assert asignados == {"HERNANDEZ HERNANDEZ JUAN": "juan.hh@aragon.unam.mx",
                     "HERNANDEZ LOPEZ MARIA": "mhl@aragon.unam.mx",
                     "RAMIREZ FLORES ANTONIO": "arf@aragon.unam.mx"}, asignados
assert not dudosos, dudosos

# Profesores: se quedan los del semestre, los que regresan recuperan su correo y los que se van se guardan.
actuales = [{"nombre": "ANA", "correo": "ana@x.mx"}, {"nombre": "BETO", "correo": "beto@x.mx"}]
anteriores = [{"nombre": "CARLA", "correo": "carla@x.mx"}]
profesores, historial, cambios = sincronizar_profesores({"ANA", "CARLA", "DANIEL"}, actuales, anteriores)
assert profesores == [{"nombre": "ANA", "correo": "ana@x.mx"}, {"nombre": "CARLA", "correo": "carla@x.mx"},
                      {"nombre": "DANIEL", "correo": None}], profesores
assert historial == [{"nombre": "BETO", "correo": "beto@x.mx"}], historial
assert cambios == {"agregados": ["DANIEL"], "recuperados": ["CARLA"], "quitados": ["BETO"]}, cambios

print("Todo bien")
