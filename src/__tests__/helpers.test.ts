import { obtenerFechaActualLocal, generarId, pad5, formatMesaName, modLabelText, obtenerHistorialCambios } from '../utils/helpers';

describe('modLabelText', () => {
  it('retorna texto legible para cada modalidad', () => {
    expect(modLabelText('local')).toBe('Local');
    expect(modLabelText('llevar')).toBe('Llevar');
    expect(modLabelText('delivery')).toBe('Delivery');
    expect(modLabelText('delivery_centro')).toBe('Centro');
  });

  it('retorna el mismo valor si no es modalidad conocida', () => {
    expect(modLabelText('otro')).toBe('otro');
    expect(modLabelText('')).toBe('');
  });
});

describe('formatMesaName', () => {
  it('formatea mesa_ prefijo como MESA', () => {
    expect(formatMesaName('mesa_1')).toBe('MESA 1');
    expect(formatMesaName('mesa_12')).toBe('MESA 12');
  });

  it('formatea DEL- prefijo como DELIVERY', () => {
    expect(formatMesaName('DEL-001')).toBe('DELIVERY: 001');
    expect(formatMesaName('DEL-999')).toBe('DELIVERY: 999');
  });

  it('formatea CTA- prefijo como CUENTA', () => {
    expect(formatMesaName('CTA-5')).toBe('CUENTA: 5');
    expect(formatMesaName('CTA-10-AB')).toBe('CUENTA: 10 AB');
  });

  it('formatea número puro como MESA', () => {
    expect(formatMesaName('1')).toBe('MESA 1');
    expect(formatMesaName('1.0')).toBe('MESA 1');
    expect(formatMesaName('25')).toBe('MESA 25');
  });

  it('retorna string vacío para null/undefined', () => {
    expect(formatMesaName(null)).toBe('');
    expect(formatMesaName(undefined)).toBe('');
    expect(formatMesaName('')).toBe('');
  });

  it('retorna el mismo valor si no coincide con ningún formato', () => {
    expect(formatMesaName('ZONA-A')).toBe('ZONA-A');
  });
});

describe('pad5', () => {
  it('rellena con ceros a la izquierda hasta 5 dígitos', () => {
    expect(pad5(1)).toBe('00001');
    expect(pad5(123)).toBe('00123');
    expect(pad5(12345)).toBe('12345');
  });
});

describe('generarId', () => {
  it('retorna un string de 8 caracteres', () => {
    const id = generarId();
    expect(typeof id).toBe('string');
    expect(id.length).toBe(8);
  });

  it('retorna IDs diferentes en llamadas sucesivas', () => {
    const id1 = generarId();
    const id2 = generarId();
    expect(id1).not.toBe(id2);
  });
});

describe('obtenerFechaActualLocal', () => {
  it('retorna fecha en formato YYYY-MM-DD', () => {
    const fecha = obtenerFechaActualLocal();
    expect(fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('retorna la fecha de hoy', () => {
    const hoy = new Date();
    const esperado = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    expect(obtenerFechaActualLocal()).toBe(esperado);
  });
});

describe('obtenerHistorialCambios', () => {
  it('retorna array vacío para pedido null/undefined/vacío', () => {
    expect(obtenerHistorialCambios(null as any)).toEqual([]);
    expect(obtenerHistorialCambios(undefined as any)).toEqual([]);
    expect(obtenerHistorialCambios([])).toEqual([]);
  });

  it('retorna array vacío cuando no hay cambios', () => {
    const pedido = [
      { nombre: 'CEVICHE', categoria: 'Entradas', cantidad: 1, nota: '', fecha_agregado: '2026-07-25' },
      { nombre: 'ARROZ CON POLLO', categoria: 'Segundos', cantidad: 1, nota: '', fecha_agregado: '2026-07-25' },
    ];
    expect(obtenerHistorialCambios(pedido)).toEqual([]);
  });

  it('detecta cambio desde item con ANULADO-CAMBIO A:', () => {
    const pedido = [
      { nombre: 'ARROZ CON POLLO', categoria: 'Segundos', nota: 'ANULADO-CAMBIO A: LOMO SALTADO', fecha_agregado: '2026-07-25' },
      { nombre: 'LOMO SALTADO', categoria: 'Segundos', nota: 'REEMPLAZA A: ARROZ CON POLLO', fecha_agregado: '2026-07-26' },
    ];
    const result = obtenerHistorialCambios(pedido);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      platoOriginal: 'ARROZ CON POLLO',
      platoNuevo: 'LOMO SALTADO',
      categoria: 'Segundos',
      fecha: '2026-07-25',
    });
  });

  it('detecta cambio desde item con REEMPLAZA A: cuando el original ya no existe', () => {
    const pedido = [
      { nombre: 'LOMO SALTADO', categoria: 'Segundos', nota: 'REEMPLAZA A: ARROZ CON POLLO', fecha_agregado: '2026-07-26' },
    ];
    const result = obtenerHistorialCambios(pedido);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      platoOriginal: 'ARROZ CON POLLO',
      platoNuevo: 'LOMO SALTADO',
      categoria: 'Segundos',
      fecha: '2026-07-26',
    });
  });

  it('no duplica cambios cuando ambos items existen (ANULADO + REEMPLAZA)', () => {
    const pedido = [
      { nombre: 'ARROZ CON POLLO', categoria: 'Segundos', nota: 'ANULADO-CAMBIO A: LOMO SALTADO', fecha_agregado: '2026-07-25' },
      { nombre: 'LOMO SALTADO', categoria: 'Segundos', nota: 'REEMPLAZA A: ARROZ CON POLLO', fecha_agregado: '2026-07-26' },
    ];
    const result = obtenerHistorialCambios(pedido);
    expect(result).toHaveLength(1);
  });

  it('detecta múltiples cambios en el mismo pedido', () => {
    const pedido = [
      { nombre: 'CEVICHE', categoria: 'Entradas', nota: 'ANULADO-CAMBIO A: CAUSA', fecha_agregado: '2026-07-25' },
      { nombre: 'CAUSA', categoria: 'Entradas', nota: 'REEMPLAZA A: CEVICHE', fecha_agregado: '2026-07-26' },
      { nombre: 'ARROZ CON POLLO', categoria: 'Segundos', nota: 'ANULADO-CAMBIO A: LOMO SALTADO', fecha_agregado: '2026-07-25' },
      { nombre: 'LOMO SALTADO', categoria: 'Segundos', nota: 'REEMPLAZA A: ARROZ CON POLLO', fecha_agregado: '2026-07-26' },
    ];
    const result = obtenerHistorialCambios(pedido);
    expect(result).toHaveLength(2);
  });

  it('extrae correctamente nombre del nuevo plato usando regex', () => {
    const pedido = [
      { nombre: 'ARROZ CON POLLO', categoria: 'Segundos', nota: 'ANULADO-CAMBIO A: LOMO SALTADO', fecha_agregado: '2026-07-25' },
    ];
    const result = obtenerHistorialCambios(pedido);
    expect(result[0].platoNuevo).toBe('LOMO SALTADO');
  });

  it('extrae correctamente nombre del original desde REEMPLAZA A:', () => {
    const pedido = [
      { nombre: 'LOMO SALTADO', categoria: 'Segundos', nota: 'REEMPLAZA A: ARROZ CON POLLO', fecha_agregado: '2026-07-26' },
    ];
    const result = obtenerHistorialCambios(pedido);
    expect(result[0].platoOriginal).toBe('ARROZ CON POLLO');
  });

  it('maneja notas con pipe separator (nota previa + cambio)', () => {
    const pedido = [
      { nombre: 'ARROZ CON POLLO', categoria: 'Segundos', nota: 'SIN SAL | ANULADO-CAMBIO A: LOMO SALTADO', fecha_agregado: '2026-07-25' },
    ];
    const result = obtenerHistorialCambios(pedido);
    expect(result).toHaveLength(1);
    expect(result[0].platoNuevo).toBe('LOMO SALTADO');
  });

  it('ordena cambios por fecha descendente (más reciente primero)', () => {
    const pedido = [
      { nombre: 'ARROZ CON POLLO', categoria: 'Segundos', nota: 'ANULADO-CAMBIO A: LOMO SALTADO', fecha_agregado: '2026-07-25' },
      { nombre: 'LOMO SALTADO', categoria: 'Segundos', nota: 'REEMPLAZA A: ARROZ CON POLLO', fecha_agregado: '2026-07-26' },
      { nombre: 'CEVICHE', categoria: 'Entradas', nota: 'ANULADO-CAMBIO A: CAUSA', fecha_agregado: '2026-07-28' },
    ];
    const result = obtenerHistorialCambios(pedido);
    expect(result[0].fecha).toBe('2026-07-28');
    expect(result[1].fecha).toBe('2026-07-25');
  });

  it('incluye categoria y fecha en el resultado', () => {
    const pedido = [
      { nombre: 'ARROZ CON POLLO', categoria: 'Segundos', nota: 'ANULADO-CAMBIO A: LOMO SALTADO', fecha_agregado: '2026-07-25' },
    ];
    const result = obtenerHistorialCambios(pedido);
    expect(result[0].categoria).toBe('Segundos');
    expect(result[0].fecha).toBe('2026-07-25');
  });

  it('ignora items sin nota', () => {
    const pedido = [
      { nombre: 'CEVICHE', categoria: 'Entradas', cantidad: 1, fecha_agregado: '2026-07-25' },
    ];
    expect(obtenerHistorialCambios(pedido)).toEqual([]);
  });

  it('ignora items con notas que no contengan ANULADO-CAMBIO o REEMPLAZA', () => {
    const pedido = [
      { nombre: 'CEVICHE', categoria: 'Entradas', nota: 'SIN SAL', fecha_agregado: '2026-07-25' },
    ];
    expect(obtenerHistorialCambios(pedido)).toEqual([]);
  });
});
