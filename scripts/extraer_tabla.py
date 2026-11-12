import pdfplumber

ruta_pdf = "pdf_origen/Horarios_L3_2027-I.pdf"

with pdfplumber.open(ruta_pdf) as pdf:
    primera_pagina = pdf.pages[0]
    tabla = primera_pagina.extract_table()

    for fila in tabla:
        print(fila)