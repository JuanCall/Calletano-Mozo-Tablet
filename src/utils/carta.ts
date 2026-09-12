// 🍽️ Agrupación de platos con dos precios (personal / fuente) para la carta del mozo.
//
// En la BD un plato con dos precios vive como DOS filas con sufijo en el nombre:
//   "CEVICHE DE PESCADO. (PERSONAL)"  S/ 30
//   "CEVICHE DE PESCADO. (FUENTE)"    S/ 55
// (los jugos / bebidas usan "(VASO)" y "(JARRA)").
//
// La tablet muestra UN solo botón con el nombre limpio y, al tocarlo, abre un modal
// para elegir la variante. El ítem que se manda a la caja CONSERVA el nombre con
// sufijo: así siguen funcionando la validación de precios, el stock y la receta.

export const VARIANTES = ['PERSONAL', 'FUENTE', 'VASO', 'JARRA'] as const;
export type Variante = (typeof VARIANTES)[number];

const REGEX_VARIANTE = /\((PERSONAL|FUENTE|VASO|JARRA)\)\s*$/i;

// Orden de presentación dentro del modal: la porción chica primero.
const ORDEN_VARIANTES: Record<Variante, number> = {
  PERSONAL: 0,
  VASO: 0,
  FUENTE: 1,
  JARRA: 1,
};

export type ItemGrupo = { plato: any; variante: Variante | null };

export type GrupoCarta = {
  key: string; // clave estable para React y para el conteo en el carrito
  base: string; // nombre limpio, sin sufijo
  items: ItemGrupo[]; // 1 ítem (plato normal) o 2 (PERSONAL/FUENTE, VASO/JARRA)
};

/**
 * Separa el sufijo de variante del nombre del plato.
 * "CEVICHE DE PESCADO. (FUENTE)" → { base: "CEVICHE DE PESCADO.", variante: "FUENTE" }
 * "CEVICHE DE PESCADO."          → { base: "CEVICHE DE PESCADO.", variante: null }
 */
export const separarVariante = (
  nombre: string,
): { base: string; variante: Variante | null } => {
  const nom = String(nombre ?? '');
  const match = nom.match(REGEX_VARIANTE);
  if (!match || match.index === undefined) return { base: nom.trim(), variante: null };
  return {
    base: nom.slice(0, match.index).trim(),
    variante: match[1].toUpperCase() as Variante,
  };
};

/**
 * Agrupa los ítems de UNA categoría por nombre base. Un plato con PERSONAL + FUENTE
 * queda como un único grupo con dos opciones; el resto queda como grupo de una sola.
 * Se conserva el orden original de la carta.
 */
export const agruparCartaPorPlato = (items: any[]): GrupoCarta[] => {
  const grupos: GrupoCarta[] = [];
  const indice = new Map<string, GrupoCarta>();

  (items || []).forEach((plato: any) => {
    if (!plato) return;
    const { base, variante } = separarVariante(plato.nombre);
    const key = base.toUpperCase();

    let grupo = indice.get(key);
    if (!grupo) {
      grupo = { key, base, items: [] };
      indice.set(key, grupo);
      grupos.push(grupo);
    }
    grupo.items.push({ plato, variante });
  });

  grupos.forEach((grupo) => {
    grupo.items.sort((a, b) => {
      const oa = a.variante ? ORDEN_VARIANTES[a.variante] : -1;
      const ob = b.variante ? ORDEN_VARIANTES[b.variante] : -1;
      if (oa !== ob) return oa - ob;
      return (a.plato?.precio || 0) - (b.plato?.precio || 0);
    });
  });

  return grupos;
};

/** Texto legible de la variante para el modal ("FUENTE" → "Fuente"). */
export const etiquetaVariante = (variante: Variante | null) =>
  variante ? variante.charAt(0) + variante.slice(1).toLowerCase() : '';

export type PlatoCarta = {
  nombre: string; // nombre limpio, sin sufijo de variante
  precio: number; // precio más bajo del grupo (el que se muestra: "Desde S/ …")
  _grupo: GrupoCarta;
  _rango: ResumenGrupo;
  [campo: string]: any;
};

/**
 * Convierte la carta que llega del backend en la carta que se pinta: un plato con
 * dos precios queda como UN solo ítem (nombre limpio) que conserva su grupo original
 * en `_grupo`, para poder mandar a la caja el nombre CON sufijo.
 */
export const agruparCartaCompleta = (carta: any[]): any[] =>
  (carta || []).map((cat: any) => ({
    ...cat,
    items: agruparCartaPorPlato(cat?.items || []).map((grupo): PlatoCarta => {
      const r = resumenGrupo(grupo);
      return {
        ...grupo.items[0].plato,
        nombre: grupo.base,
        precio: r.precioMin,
        _grupo: grupo,
        _rango: r,
      };
    }),
  }));

export type MasPedido = { grupo: GrupoCarta; categoria: string; plato: PlatoCarta; cantidad: number };

/**
 * Resuelve el ranking que manda el backend (/api/mas-pedidos) contra la carta actual.
 * El backend devuelve el nombre EXACTO de la tabla `platos`, así que aquí es un match
 * directo. Se descartan los platos que ya no están en la carta y se evita repetir un
 * mismo grupo (la clave del grupo ya une personal + fuente).
 */
export const resolverMasPedidos = (
  cartaAgrupada: any[],
  ranking: any[],
  limite = 8,
): MasPedido[] => {
  const indice = new Map<string, { grupo: GrupoCarta; categoria: string; plato: PlatoCarta }>();
  (cartaAgrupada || []).forEach((cat: any) => {
    (cat?.items || []).forEach((plato: PlatoCarta) => {
      (plato?._grupo?.items || []).forEach((g) =>
        indice.set(g.plato.nombre, { grupo: plato._grupo, categoria: cat.nombre, plato }),
      );
    });
  });

  const lista: MasPedido[] = [];
  const vistos = new Set<string>();
  (ranking || []).forEach((entrada: any) => {
    if (!entrada || !entrada.nombre) return;
    const hit = indice.get(entrada.nombre);
    if (!hit || vistos.has(hit.grupo.key)) return;
    vistos.add(hit.grupo.key);
    lista.push({ ...hit, cantidad: Number(entrada.cantidad) || 0 });
  });

  return lista.slice(0, limite);
};

export type ResumenGrupo = {
  variantes: number;
  precioMin: number;
  precioMax: number;
  mismoPrecio: boolean;
  agotado: boolean;
  stockMin: number | null;
};

/**
 * Resumen para pintar el botón: precio desde / hasta, stock y si TODAS las
 * variantes están agotadas (solo así se deshabilita el botón).
 */
export const resumenGrupo = (grupo: GrupoCarta): ResumenGrupo => {
  const precios = grupo.items.map((i) => Number(i.plato?.precio) || 0);
  const precioMin = precios.length ? Math.min(...precios) : 0;
  const precioMax = precios.length ? Math.max(...precios) : 0;

  const stocks = grupo.items
    .map((i) => i.plato?.stock_actual)
    .filter((v): v is number => v !== null && v !== undefined);

  const todosAgotados = grupo.items.every((i) => {
    const st = i.plato?.stock_actual;
    return st !== null && st !== undefined && st <= 0;
  });

  return {
    variantes: grupo.items.length,
    precioMin,
    precioMax,
    mismoPrecio: Math.abs(precioMax - precioMin) < 0.01,
    agotado: grupo.items.length > 0 && todosAgotados,
    stockMin: stocks.length ? Math.min(...stocks) : null,
  };
};
