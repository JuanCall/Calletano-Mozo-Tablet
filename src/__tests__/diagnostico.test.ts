import {
  limpiarIp,
  esTimeout,
  estadoHttp,
  interpretarError,
  formatearDiagnostico,
  diagnosticoOk,
  diagnosticoDeCausa,
  etiquetaCausa,
  PUERTO_CAJA,
} from '../utils/diagnostico';

// Objetos de error tal como los entrega axios en React Native.
const errorSinRespuesta = (extra: Record<string, any> = {}) => ({
  message: 'Network Error',
  code: 'ERR_NETWORK',
  request: {},
  ...extra,
});

const errorConRespuesta = (status: number) => ({
  message: `Request failed with status code ${status}`,
  response: { status, data: {} },
  request: {},
});

describe('limpiarIp', () => {
  it('quita espacios y normaliza lo que pega el usuario', () => {
    expect(limpiarIp('  192.168.1.50 ')).toBe('192.168.1.50');
    expect(limpiarIp('https://192.168.18.32')).toBe('192.168.18.32');
    expect(limpiarIp('http://192.168.18.32:3001')).toBe('192.168.18.32');
    expect(limpiarIp('192.168.18.32/')).toBe('192.168.18.32');
  });

  it('devuelve cadena vacía para valores nulos', () => {
    expect(limpiarIp(null)).toBe('');
    expect(limpiarIp(undefined)).toBe('');
  });
});

describe('esTimeout', () => {
  it('detecta el timeout de axios', () => {
    expect(esTimeout({ code: 'ECONNABORTED', message: 'timeout of 4000ms exceeded' })).toBe(true);
    expect(esTimeout({ code: 'ETIMEDOUT' })).toBe(true);
    expect(esTimeout({ message: 'Timeout of 3000ms exceeded' })).toBe(true);
  });

  it('NO confunde un error de red inmediato con un timeout', () => {
    expect(esTimeout(errorSinRespuesta())).toBe(false);
    expect(esTimeout(undefined)).toBe(false);
  });
});

describe('estadoHttp', () => {
  it('devuelve el código cuando la Caja respondió', () => {
    expect(estadoHttp(errorConRespuesta(401))).toBe(401);
    expect(estadoHttp(errorConRespuesta(500))).toBe(500);
  });

  it('devuelve null cuando no hubo respuesta', () => {
    expect(estadoHttp(errorSinRespuesta())).toBeNull();
    expect(estadoHttp(undefined)).toBeNull();
  });
});

describe('interpretarError', () => {
  it('401/403 → la tablet no está autorizada (token)', () => {
    expect(interpretarError(errorConRespuesta(401), '192.168.1.50').causa).toBe('token');
    expect(interpretarError(errorConRespuesta(403), '192.168.1.50').causa).toBe('token');
  });

  it('otros códigos HTTP → error de la Caja (el certificado y la red están bien)', () => {
    const d = interpretarError(errorConRespuesta(500), '192.168.1.50');
    expect(d.causa).toBe('servidor');
    expect(d.detalle).toContain('500');
  });

  it('timeout → nadie responde en esa IP', () => {
    const d = interpretarError(errorSinRespuesta({ code: 'ECONNABORTED', message: 'timeout of 4000ms exceeded' }), '192.168.1.50');
    expect(d.causa).toBe('ip');
    expect(d.detalle).toContain('192.168.1.50');
    expect(d.detalle).toContain(String(PUERTO_CAJA));
  });

  it('fallo de red inmediato → la Caja rechazó el HTTPS', () => {
    expect(interpretarError(errorSinRespuesta(), '192.168.1.50').causa).toBe('tls');
  });

  it('sin error reconocible → causa desconocida, nunca "conectado"', () => {
    const causa = interpretarError(undefined, '192.168.1.50').causa;
    expect(causa).not.toBe('ok');
  });
});

describe('diagnosticoDeCausa / diagnosticoOk', () => {
  it('cada causa trae su propio estadoCorto', () => {
    const causas = ['ip', 'tls', 'token', 'servidor', 'desconocido'] as const;
    const cortos = causas.map((c) => diagnosticoDeCausa(c, { ip: '10.0.0.5' }).estadoCorto);
    expect(new Set(cortos).size).toBe(causas.length);
  });

  it('diagnosticoOk marca la conexión como correcta', () => {
    const d = diagnosticoOk('192.168.1.50');
    expect(d.causa).toBe('ok');
    expect(d.estadoCorto).toBe('Conectado');
  });
});

describe('formatearDiagnostico', () => {
  it('arma titulo + detalle + sugerencia para los fallos', () => {
    const texto = formatearDiagnostico(diagnosticoDeCausa('ip', { ip: '192.168.1.50' }));
    expect(texto).toContain('La Caja no responde');
    expect(texto).toContain('192.168.1.50');
    expect(texto).toContain('Verifica en Ajustes');
  });

  it('para el caso correcto devuelve solo el titulo', () => {
    expect(formatearDiagnostico(diagnosticoOk('192.168.1.50'))).toBe('Conectado');
  });
});

describe('etiquetaCausa', () => {
  it('distingue explícitamente las tres causas que antes se confundían', () => {
    expect(etiquetaCausa('ip')).toContain('IP');
    expect(etiquetaCausa('token')).toContain('CLAVE');
    expect(etiquetaCausa('tls')).toContain('CERTIFICADO');
  });

  it('cae en "ERROR DE CONEXIÓN" si la causa es desconocida', () => {
    expect(etiquetaCausa('cualquiera' as any)).toBe('ERROR DE CONEXIÓN');
  });
});
