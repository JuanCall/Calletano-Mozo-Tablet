import {
  separarVariante,
  agruparCartaPorPlato,
  agruparCartaCompleta,
  resolverMasPedidos,
  etiquetaVariante,
  resumenGrupo,
} from '../utils/carta';

describe('separarVariante', () => {
  it('separa el sufijo (PERSONAL) y (FUENTE)', () => {
    expect(separarVariante('CEVICHE DE PESCADO. (PERSONAL)')).toEqual({
      base: 'CEVICHE DE PESCADO.',
      variante: 'PERSONAL',
    });
    expect(separarVariante('CEVICHE DE PESCADO. (FUENTE)')).toEqual({
      base: 'CEVICHE DE PESCADO.',
      variante: 'FUENTE',
    });
  });

  it('separa el sufijo (VASO) y (JARRA) de los jugos', () => {
    expect(separarVariante('FRESA (VASO)')).toEqual({ base: 'FRESA', variante: 'VASO' });
    expect(separarVariante('FRESA (JARRA)')).toEqual({ base: 'FRESA', variante: 'JARRA' });
  });

  it('es insensible a mayúsculas y a espacios sobrantes', () => {
    expect(separarVariante('CEVICHE   (personal)  ')).toEqual({
      base: 'CEVICHE',
      variante: 'PERSONAL',
    });
  });

  it('deja intacto un plato sin variante', () => {
    expect(separarVariante('MILANESA DE POLLO')).toEqual({
      base: 'MILANESA DE POLLO',
      variante: null,
    });
  });

  it('no confunde un paréntesis que no es variante', () => {
    expect(separarVariante('CHAUFA (ESPECIAL)')).toEqual({
      base: 'CHAUFA (ESPECIAL)',
      variante: null,
    });
  });

  it('tolera null / undefined / string vacío', () => {
    expect(separarVariante('')).toEqual({ base: '', variante: null });
    expect(separarVariante(null as any)).toEqual({ base: '', variante: null });
    expect(separarVariante(undefined as any)).toEqual({ base: '', variante: null });
  });
});

describe('agruparCartaPorPlato', () => {
  const carta = [
    { id: 1, nombre: 'CEVICHE DE PESCADO. (PERSONAL)', precio: 30 },
    { id: 2, nombre: 'CEVICHE DE PESCADO. (FUENTE)', precio: 55 },
    { id: 3, nombre: 'MILANESA DE POLLO', precio: 25 },
    { id: 4, nombre: 'FRESA (JARRA)', precio: 15 },
    { id: 5, nombre: 'FRESA (VASO)', precio: 8 },
  ];

  it('junta PERSONAL + FUENTE en un solo grupo', () => {
    const grupos = agruparCartaPorPlato(carta);
    const ceviche = grupos.find((g) => g.base === 'CEVICHE DE PESCADO.');
    expect(ceviche).toBeDefined();
    expect(ceviche!.items).toHaveLength(2);
    expect(ceviche!.items.map((i) => i.variante)).toEqual(['PERSONAL', 'FUENTE']);
  });

  it('ordena la porción chica primero (también VASO antes que JARRA)', () => {
    const grupos = agruparCartaPorPlato(carta);
    const fresa = grupos.find((g) => g.base === 'FRESA');
    expect(fresa!.items.map((i) => i.variante)).toEqual(['VASO', 'JARRA']);
    expect(fresa!.items.map((i) => i.plato.precio)).toEqual([8, 15]);
  });

  it('deja los platos sin variante como grupo de una sola opción', () => {
    const grupos = agruparCartaPorPlato(carta);
    const milanesa = grupos.find((g) => g.base === 'MILANESA DE POLLO');
    expect(milanesa!.items).toHaveLength(1);
    expect(milanesa!.items[0].variante).toBeNull();
    expect(milanesa!.items[0].plato.id).toBe(3);
  });

  it('no pierde ningún plato de la categoría', () => {
    const grupos = agruparCartaPorPlato(carta);
    const total = grupos.reduce((acc, g) => acc + g.items.length, 0);
    expect(total).toBe(carta.length);
    expect(grupos).toHaveLength(3); // ceviche, milanesa, fresa
  });

  it('conserva el orden de aparición de la carta', () => {
    const grupos = agruparCartaPorPlato(carta);
    expect(grupos.map((g) => g.base)).toEqual(['CEVICHE DE PESCADO.', 'MILANESA DE POLLO', 'FRESA']);
  });

  it('mantiene el nombre CON sufijo en el ítem que se manda a la caja', () => {
    const grupos = agruparCartaPorPlato(carta);
    const ceviche = grupos.find((g) => g.base === 'CEVICHE DE PESCADO.');
    expect(ceviche!.items[0].plato.nombre).toBe('CEVICHE DE PESCADO. (PERSONAL)');
    expect(ceviche!.items[1].plato.nombre).toBe('CEVICHE DE PESCADO. (FUENTE)');
  });

  it('tolera lista vacía o nula', () => {
    expect(agruparCartaPorPlato([])).toEqual([]);
    expect(agruparCartaPorPlato(null as any)).toEqual([]);
  });
});

describe('agruparCartaCompleta', () => {
  const carta = [
    {
      nombre: 'Platos de entrada',
      items: [
        { id: 1, nombre: 'CEVICHE DE PESCADO. (PERSONAL)', precio: 30, stock_actual: null },
        { id: 2, nombre: 'CEVICHE DE PESCADO. (FUENTE)', precio: 55, stock_actual: null },
        { id: 3, nombre: 'LECHE DE TIGRE', precio: 20, stock_actual: null },
      ],
    },
  ];

  it('deja un solo ítem por plato con el nombre limpio', () => {
    const agrupada = agruparCartaCompleta(carta);
    expect(agrupada[0].items).toHaveLength(2);
    expect(agrupada[0].items[0].nombre).toBe('CEVICHE DE PESCADO.');
    expect(agrupada[0].items[1].nombre).toBe('LECHE DE TIGRE');
  });

  it('muestra el precio más bajo y guarda el rango', () => {
    const ceviche = agruparCartaCompleta(carta)[0].items[0];
    expect(ceviche.precio).toBe(30);
    expect(ceviche._rango.precioMax).toBe(55);
    expect(ceviche._rango.variantes).toBe(2);
  });

  it('conserva el grupo con los nombres CON sufijo para la caja', () => {
    const ceviche = agruparCartaCompleta(carta)[0].items[0];
    expect(ceviche._grupo.items.map((i: any) => i.plato.nombre)).toEqual([
      'CEVICHE DE PESCADO. (PERSONAL)',
      'CEVICHE DE PESCADO. (FUENTE)',
    ]);
  });

  it('conserva el resto de campos del plato (id, stock, taper…)', () => {
    const agrupada = agruparCartaCompleta([
      { nombre: 'Pollo', items: [{ id: 9, nombre: 'MILANESA', precio: 25, stock_actual: 4, taper: ['chico'] }] },
    ]);
    expect(agrupada[0].items[0]).toMatchObject({ id: 9, stock_actual: 4, taper: ['chico'] });
  });

  it('tolera carta vacía o nula', () => {
    expect(agruparCartaCompleta([])).toEqual([]);
    expect(agruparCartaCompleta(null as any)).toEqual([]);
  });
});

describe('resolverMasPedidos', () => {
  const cartaAgrupada = agruparCartaCompleta([
    {
      nombre: 'Platos de entrada',
      items: [
        { id: 1, nombre: 'CEVICHE MIXTO. (PERSONAL)', precio: 35 },
        { id: 2, nombre: 'CEVICHE MIXTO. (FUENTE)', precio: 65 },
      ],
    },
    { nombre: 'Pollo', items: [{ id: 5, nombre: 'MILANESA DE POLLO', precio: 25 }] },
  ]);

  it('resuelve el nombre exacto de la carta contra el grupo correcto', () => {
    const lista = resolverMasPedidos(cartaAgrupada, [
      { nombre: 'CEVICHE MIXTO. (PERSONAL)', cantidad: 13, categoria: 'Platos de entrada' },
    ]);
    expect(lista).toHaveLength(1);
    expect(lista[0].grupo.base).toBe('CEVICHE MIXTO.');
    expect(lista[0].categoria).toBe('Platos de entrada');
    expect(lista[0].cantidad).toBe(13);
    expect(lista[0].plato.precio).toBe(35);
  });

  it('no repite un plato si el ranking llega con personal y fuente por separado', () => {
    const lista = resolverMasPedidos(cartaAgrupada, [
      { nombre: 'CEVICHE MIXTO. (PERSONAL)', cantidad: 8 },
      { nombre: 'CEVICHE MIXTO. (FUENTE)', cantidad: 4 },
      { nombre: 'MILANESA DE POLLO', cantidad: 5 },
    ]);
    expect(lista.map((m) => m.grupo.base)).toEqual(['CEVICHE MIXTO.', 'MILANESA DE POLLO']);
  });

  it('descarta platos que ya no están en la carta', () => {
    const lista = resolverMasPedidos(cartaAgrupada, [
      { nombre: 'PLATO DESCONTINUADO', cantidad: 99 },
      { nombre: 'MILANESA DE POLLO', cantidad: 2 },
    ]);
    expect(lista.map((m) => m.grupo.base)).toEqual(['MILANESA DE POLLO']);
  });

  it('mantiene el orden de popularidad y respeta el límite', () => {
    const lista = resolverMasPedidos(cartaAgrupada, [
      { nombre: 'MILANESA DE POLLO', cantidad: 9 },
      { nombre: 'CEVICHE MIXTO. (FUENTE)', cantidad: 7 },
    ]);
    expect(lista.map((m) => m.cantidad)).toEqual([9, 7]);
    expect(resolverMasPedidos(cartaAgrupada, [{ nombre: 'MILANESA DE POLLO', cantidad: 1 }], 0)).toEqual([]);
  });

  it('tolera ranking vacío, nulo o entradas incompletas', () => {
    expect(resolverMasPedidos(cartaAgrupada, [])).toEqual([]);
    expect(resolverMasPedidos(cartaAgrupada, null as any)).toEqual([]);
    expect(resolverMasPedidos(cartaAgrupada, [null, {}, { nombre: '' }])).toEqual([]);
  });
});

describe('etiquetaVariante', () => {
  it('devuelve el texto capitalizado', () => {
    expect(etiquetaVariante('PERSONAL')).toBe('Personal');
    expect(etiquetaVariante('FUENTE')).toBe('Fuente');
    expect(etiquetaVariante('VASO')).toBe('Vaso');
    expect(etiquetaVariante('JARRA')).toBe('Jarra');
    expect(etiquetaVariante(null)).toBe('');
  });
});

describe('resumenGrupo', () => {
  it('reporta el rango de precios y cuántas opciones hay', () => {
    const grupo = agruparCartaPorPlato([
      { nombre: 'CEVICHE (PERSONAL)', precio: 30, stock_actual: null },
      { nombre: 'CEVICHE (FUENTE)', precio: 55, stock_actual: null },
    ])[0];
    const r = resumenGrupo(grupo);
    expect(r.variantes).toBe(2);
    expect(r.precioMin).toBe(30);
    expect(r.precioMax).toBe(55);
    expect(r.mismoPrecio).toBe(false);
    expect(r.agotado).toBe(false);
  });

  it('marca mismoPrecio cuando ambas variantes valen igual', () => {
    const grupo = agruparCartaPorPlato([
      { nombre: 'CHAUFA (PERSONAL)', precio: 20 },
      { nombre: 'CHAUFA (FUENTE)', precio: 20 },
    ])[0];
    expect(resumenGrupo(grupo).mismoPrecio).toBe(true);
  });

  it('solo marca agotado si TODAS las variantes lo están', () => {
    const conStock = agruparCartaPorPlato([
      { nombre: 'CHAUFA (PERSONAL)', precio: 20, stock_actual: 0 },
      { nombre: 'CHAUFA (FUENTE)', precio: 40, stock_actual: 3 },
    ])[0];
    expect(resumenGrupo(conStock).agotado).toBe(false);
    expect(resumenGrupo(conStock).stockMin).toBe(0);

    const agotado = agruparCartaPorPlato([
      { nombre: 'CHAUFA (PERSONAL)', precio: 20, stock_actual: 0 },
      { nombre: 'CHAUFA (FUENTE)', precio: 40, stock_actual: 0 },
    ])[0];
    expect(resumenGrupo(agotado).agotado).toBe(true);
  });

  it('ignora el stock cuando es null (plato de carta sin receta)', () => {
    const grupo = agruparCartaPorPlato([{ nombre: 'MILANESA', precio: 25, stock_actual: null }])[0];
    const r = resumenGrupo(grupo);
    expect(r.agotado).toBe(false);
    expect(r.stockMin).toBeNull();
    expect(r.variantes).toBe(1);
  });
});
