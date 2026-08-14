import {
  normalizarDocumento,
  validarDocumento,
  extraerDocumentoDeQR,
  extraerCodigoTarjeta,
  esCodigoLegacy,
  esTokenValido,
  generarTokenTarjeta,
  construirUrlTarjeta,
  enmascararDocumento,
  calcularProgreso,
  yaRegistroVisitaHoy,
  filtrarSocios,
} from '../utils/club';

describe('normalizarDocumento', () => {
  it('quita espacios, puntos y guiones', () => {
    expect(normalizarDocumento(' 12 345 678 ')).toBe('12345678');
    expect(normalizarDocumento('1234-5678')).toBe('12345678');
    expect(normalizarDocumento('123.456.78')).toBe('12345678');
    expect(normalizarDocumento('12-34. 5678')).toBe('12345678');
  });

  it('maneja null/undefined/vacío sin explotar', () => {
    expect(normalizarDocumento(null)).toBe('');
    expect(normalizarDocumento(undefined)).toBe('');
    expect(normalizarDocumento('')).toBe('');
  });
});

describe('validarDocumento', () => {
  it('DNI: acepta exactamente 8 dígitos', () => {
    expect(validarDocumento('DNI', '12345678')).toBe(true);
    expect(validarDocumento('DNI', '00000000')).toBe(true);
  });

  it('DNI: rechaza 7, 9 dígitos y letras', () => {
    expect(validarDocumento('DNI', '1234567')).toBe(false);
    expect(validarDocumento('DNI', '123456789')).toBe(false);
    expect(validarDocumento('DNI', '1234567A')).toBe(false);
    expect(validarDocumento('DNI', 'ABCDEFGH')).toBe(false);
  });

  it('CE: acepta entre 9 y 12 dígitos', () => {
    expect(validarDocumento('CE', '123456789')).toBe(true);
    expect(validarDocumento('CE', '123456789012')).toBe(true);
  });

  it('CE: rechaza 8 o 13 dígitos', () => {
    expect(validarDocumento('CE', '12345678')).toBe(false);
    expect(validarDocumento('CE', '1234567890123')).toBe(false);
  });

  it('AUTO: acepta DNI o CE', () => {
    expect(validarDocumento('AUTO', '12345678')).toBe(true);
    expect(validarDocumento('AUTO', '123456789012')).toBe(true);
    expect(validarDocumento('AUTO', '1234567')).toBe(false);
  });
});

describe('extraerDocumentoDeQR', () => {
  it('extrae DNI desde una URL con parámetro club', () => {
    expect(extraerDocumentoDeQR('https://calletano-restaurant.web.app/?club=12345678')).toBe('12345678');
  });

  it('extrae CE (9-12 dígitos) desde una URL', () => {
    expect(extraerDocumentoDeQR('https://calletano-restaurant.web.app/?club=123456789012')).toBe('123456789012');
  });

  it('acepta texto plano con solo dígitos', () => {
    expect(extraerDocumentoDeQR('12345678')).toBe('12345678');
  });

  it('ignora basura alrededor de los dígitos', () => {
    expect(extraerDocumentoDeQR('CALLETANO-CLUB: 12345678')).toBe('12345678');
  });

  it('rechaza documentos inválidos', () => {
    expect(extraerDocumentoDeQR('https://calletano-restaurant.web.app/?club=1234')).toBe(null);
    expect(extraerDocumentoDeQR('hola mundo')).toBe(null);
    expect(extraerDocumentoDeQR('')).toBe(null);
    expect(extraerDocumentoDeQR(null)).toBe(null);
  });
});

describe('generarTokenTarjeta (token opaco)', () => {
  it('genera un token alfanumérico de 20 caracteres con letra y dígito', () => {
    const token = generarTokenTarjeta();
    expect(token).toMatch(/^[A-Z0-9]{20}$/);
    expect(/[A-Z]/.test(token)).toBe(true);
    expect(/[0-9]/.test(token)).toBe(true);
  });

  it('genera tokens distintos en cada llamada', () => {
    expect(generarTokenTarjeta()).not.toBe(generarTokenTarjeta());
  });
});

describe('esCodigoLegacy', () => {
  it('DNI/CE (solo dígitos) son legacy; los tokens NO', () => {
    expect(esCodigoLegacy('12345678')).toBe(true);
    expect(esCodigoLegacy('123456789012')).toBe(true);
    expect(esCodigoLegacy('A1B2C3D4E5F6G7H8J9K0')).toBe(false);
    expect(esCodigoLegacy(null)).toBe(false);
  });
});

describe('esTokenValido (token opaco válido)', () => {
  it('acepta tokens con letra y dígito', () => {
    expect(esTokenValido(generarTokenTarjeta())).toBe(true);
    expect(esTokenValido('A1B2C3D4E5F6G7H8J9K0')).toBe(true);
    expect(esTokenValido('AB12CD34')).toBe(true);
  });

  it('rechaza documentos legacy (solo dígitos)', () => {
    expect(esTokenValido('12345678')).toBe(false);
    expect(esTokenValido('123456789012')).toBe(false);
  });

  it('rechaza texto basura (solo letras) y códigos inválidos', () => {
    expect(esTokenValido('HOLAMUNDO')).toBe(false);
    expect(esTokenValido('AB12')).toBe(false);
    expect(esTokenValido('')).toBe(false);
    expect(esTokenValido(null)).toBe(false);
  });
});

describe('extraerCodigoTarjeta (token o documento)', () => {
  it('extrae token opaco desde la URL del QR', () => {
    expect(extraerCodigoTarjeta('https://calletano-restaurant.web.app/club-consultar.html?club=A1B2C3D4E5F6G7H8J9K0')).toBe('A1B2C3D4E5F6G7H8J9K0');
  });

  it('extrae documento legacy desde la URL', () => {
    expect(extraerCodigoTarjeta('https://calletano-restaurant.web.app/?club=12345678')).toBe('12345678');
  });

  it('rechaza códigos inválidos', () => {
    expect(extraerCodigoTarjeta('hola mundo')).toBe(null);
    expect(extraerCodigoTarjeta('')).toBe(null);
    expect(extraerCodigoTarjeta(null)).toBe(null);
  });
});

describe('construirUrlTarjeta', () => {
  it('arma el link con el token sin exponer el documento', () => {
    const url = construirUrlTarjeta('A1B2C3D4E5F6G7H8J9K0');
    expect(url).toContain('?club=A1B2C3D4E5F6G7H8J9K0');
    expect(url).not.toContain('12345678');
  });
});

describe('enmascararDocumento', () => {
  it('muestra solo los últimos 4 dígitos con prefijo ****', () => {
    expect(enmascararDocumento('12345678')).toBe('****5678');
    expect(enmascararDocumento('123456789012')).toBe('****9012');
  });

  it('no enmascara documentos de 4 dígitos o menos', () => {
    expect(enmascararDocumento('1234')).toBe('1234');
  });

  it('tolera null/undefined/vacío', () => {
    expect(enmascararDocumento(null)).toBe('');
    expect(enmascararDocumento(undefined)).toBe('');
    expect(enmascararDocumento('')).toBe('');
  });
});

describe('calcularProgreso', () => {
  it('0 de 8: 0%, faltan 8, no completado', () => {
    expect(calcularProgreso(0, 8)).toEqual({
      visitas: 0,
      meta: 8,
      restantes: 8,
      porcentaje: 0,
      completado: false,
    });
  });

  it('4 de 8: 50%, faltan 4', () => {
    const p = calcularProgreso(4, 8);
    expect(p.porcentaje).toBe(50);
    expect(p.restantes).toBe(4);
    expect(p.completado).toBe(false);
  });

  it('8 de 8: 100%, premio completado', () => {
    const p = calcularProgreso(8, 8);
    expect(p.porcentaje).toBe(100);
    expect(p.restantes).toBe(0);
    expect(p.completado).toBe(true);
  });

  it('más visitas que la meta: no pasa de 100%', () => {
    const p = calcularProgreso(10, 8);
    expect(p.porcentaje).toBe(100);
    expect(p.completado).toBe(true);
  });

  it('tolera valores no numéricos', () => {
    expect(calcularProgreso('4', '8').visitas).toBe(4);
    expect(calcularProgreso(undefined, undefined).visitas).toBe(0);
  });
});

describe('filtrarSocios', () => {
  const socios: any[] = [
    { nombre: 'María Pérez', documento: '12345678', tipo_documento: 'DNI', visitas: 5 },
    { nombre: 'Juan López', documento: '87654321', tipo_documento: 'DNI', visitas: 9 },
    { nombre: 'Ana Torres', documento: '123456789012', tipo_documento: 'CE', visitas: 2 },
  ];

  it('devuelve todos si no hay búsqueda', () => {
    expect(filtrarSocios(socios, '')).toHaveLength(3);
    expect(filtrarSocios(socios, '   ')).toHaveLength(3);
    expect(filtrarSocios(socios, null as any)).toHaveLength(3);
  });

  it('filtra por nombre (sin distinguir mayúsculas)', () => {
    const res = filtrarSocios(socios, 'MARÍA');
    expect(res).toHaveLength(1);
    expect(res[0].nombre).toBe('María Pérez');
  });

  it('filtra por documento (parcial)', () => {
    const res = filtrarSocios(socios, '8765');
    expect(res).toHaveLength(1);
    expect(res[0].nombre).toBe('Juan López');
  });

  it('filtra por tipo de documento', () => {
    const res = filtrarSocios(socios, 'CE');
    expect(res).toHaveLength(1);
    expect(res[0].tipo_documento).toBe('CE');
  });

  it('devuelve lista vacía si no hay coincidencias', () => {
    expect(filtrarSocios(socios, 'zzz')).toHaveLength(0);
  });
});

describe('yaRegistroVisitaHoy', () => {
  it('retorna false si no hay registro de última visita', () => {
    expect(yaRegistroVisitaHoy(null, 'Máncora', '2026-07-31')).toBe(false);
    expect(yaRegistroVisitaHoy(undefined, 'Máncora', '2026-07-31')).toBe(false);
    expect(yaRegistroVisitaHoy({}, 'Máncora', '2026-07-31')).toBe(false);
  });

  it('retorna true si la última visita en la sede fue hoy', () => {
    expect(yaRegistroVisitaHoy({ 'Máncora': '2026-07-31' }, 'Máncora', '2026-07-31')).toBe(true);
  });

  it('retorna false si la última visita fue otro día', () => {
    expect(yaRegistroVisitaHoy({ 'Máncora': '2026-07-30' }, 'Máncora', '2026-07-31')).toBe(false);
  });

  it('cuenta por sede: una visita en otra sede no bloquea', () => {
    expect(yaRegistroVisitaHoy({ 'El Golf': '2026-07-31' }, 'Máncora', '2026-07-31')).toBe(false);
  });

  it('retorna false si el valor está vacío', () => {
    expect(yaRegistroVisitaHoy({ 'Máncora': '' }, 'Máncora', '2026-07-31')).toBe(false);
  });
});
