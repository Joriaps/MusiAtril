// Ayuda en frases cortas: qué tocar para cada cosa. Primero lo que tranquiliza.
import { h } from './util.js';

export function helpTab(body, toLibrary) {
  const box = h('div', { class: 'scroll fillrows settings help' });
  body.appendChild(box);
  const sec = (t, ...lines) => box.appendChild(h('div', { class: 'sec' }, h('h2', { text: t }), ...lines.filter(Boolean).map((l) => h('p', { text: l }))));

  sec('Tranquilidad',
    'Nada se borra sin preguntarte antes.',
    'Si no sabes dónde estás, pulsa «Volver», arriba a la izquierda, y vuelves a la pantalla anterior.');
  if (__WEB__) {
    sec('Añadir partituras',
      '1. Descarga los PDFs en el iPad. Por ejemplo, desde Drive: abre la partitura y pulsa Descargar.',
      '2. En «Partituras», pulsa «Añadir partituras».',
      '3. Busca la carpeta «Descargas» y toca la partitura. Para añadir varias a la vez, pulsa antes «Seleccionar», márcalas y pulsa «Abrir».');
  } else {
    sec('Añadir partituras',
      '1. Enciende el ordenador y pon en marcha Atril en él.',
      '2. En «Partituras», pulsa «Importar desde el PC» y escribe el código de 6 cifras que sale en el ordenador.',
      '3. Marca las partituras y pulsa «Importar».');
  }
  sec('Leer y pasar página',
    'Toca una partitura para abrirla.',
    'Toca en la parte derecha de la página para pasar a la siguiente, y en la parte izquierda para volver a la anterior.',
    'Toca en el centro para ver u ocultar los botones de arriba. Con un pedal también se pasa página.');
  sec('Volver a la lista',
    'Toca en el centro de la página y pulsa «Volver», arriba a la izquierda.');
  sec('Escribir en la partitura',
    'Con la partitura abierta, toca en el centro y pulsa «Anotar».',
    'Elige Lápiz, Resaltar o Texto y escribe con el dedo o con el lápiz. Si te equivocas, pulsa «Deshacer».',
    'Cuando acabes, pulsa «Listo». Se guarda solo.');
  sec('Conciertos',
    'En «Conciertos» puedes juntar las obras de un concierto en su orden.',
    'Pulsa «Tocar» y, al terminar cada obra, Atril pasa sola a la siguiente.');
  sec('Copia de seguridad',
    'Si el iPad se queda sin espacio, puede borrar los datos de Atril. Por eso conviene guardar una copia de vez en cuando y siempre antes de un concierto.',
    __WEB__ ? 'Ve a «Opciones» y pulsa «Guardar copia en el iPad». Guarda carpetas, conciertos y anotaciones, pero no los PDFs: no los borres de Drive.'
      : 'Ve a «Opciones» y pulsa «Copia completa al PC» con el ordenador encendido.');
  sec('Si algo no va bien',
    'Cierra Atril y vuelve a abrirla desde su icono. Tus partituras y anotaciones no se pierden.');
  box.appendChild(h('div', { class: 'tools' }, h('button', { class: 'main', click: toLibrary }, 'Volver a mis partituras')));
}
