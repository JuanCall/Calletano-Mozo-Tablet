// 🩺 Diagnóstico de conexión con la Caja.
//
// Antes, cualquier fallo mostraba el mismo texto: "Revisa la IP de la Caja".
// Eso confundía tres problemas MUY distintos, que se arreglan de maneras
// distintas:
//
//   • IP incorrecta / Caja apagada   → nadie responde en <ip>:3001
//   • Certificado no reconocido      → algo responde, pero rechaza el HTTPS
//   • Token inválido (falta la clave)→ la Caja responde 401 a la app
//
// Cómo se distinguen (sin inventar): el backend expone GET /api/status como
// ruta PÚBLICA (no pide token — backend/middleware/apiAuth.js). Esa sonda
// separa la capa de red/TLS de la capa de autorización:
//
//   1. Si la llamada fallida SÍ trajo respuesta HTTP → TLS y red funcionan:
//      es 401 (token) o un error de la Caja.
//   2. Si no trajo respuesta → se lanza la sonda pública:
//        - timeout            → nadie contestó        → 'ip'
//        - error rápido       → contestó y cortó TLS  → 'tls'
//
// Es puro (no hace red): recibe el objeto de error de axios y devuelve el
// diagnóstico. Así se puede testear sin mocks de red.

export const PUERTO_CAJA = 3001;

export type CausaConexion = 'ok' | 'ip' | 'tls' | 'token' | 'servidor' | 'desconocido';

export type Diagnostico = {
  causa: CausaConexion;
  /** Titular corto, para el pill de estado. */
  estadoCorto: string;
  /** Qué pasó, en una línea. */
  titulo: string;
  /** Detalle técnico en lenguaje simple. */
  detalle: string;
  /** Qué debe hacer la persona. */
  sugerencia: string;
};

/** Normaliza la IP escrita por el usuario (quita espacios y el esquema si lo pegó completo). */
export const limpiarIp = (ip: unknown): string =>
  String(ip ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/:\d+$/, '')
    .replace(/\/+$/, '');

/** ¿El error fue un timeout (nadie contestó a tiempo)? */
export const esTimeout = (error: any): boolean => {
  if (!error) return false;
  const codigo = String(error.code ?? '').toUpperCase();
  if (codigo === 'ECONNABORTED' || codigo === 'ETIMEDOUT') return true;
  return String(error.message ?? '').toLowerCase().includes('timeout');
};

/** Código HTTP de la respuesta, o null si la petición no llegó a responder. */
export const estadoHttp = (error: any): number | null => {
  const status = error?.response?.status;
  return typeof status === 'number' ? status : null;
};

const construir = (
  causa: CausaConexion,
  datos: { ip?: string; status?: number | null } = {},
): Diagnostico => {
  const ip = limpiarIp(datos.ip) || 'la Caja';

  switch (causa) {
    case 'ok':
      return {
        causa: 'ok',
        estadoCorto: 'Conectado',
        titulo: 'Conectado',
        detalle: `La tablet está conectada a ${ip}.`,
        sugerencia: '',
      };

    case 'ip':
      return {
        causa: 'ip',
        estadoCorto: 'Sin respuesta',
        titulo: 'La Caja no responde',
        detalle: `Nadie contestó en ${ip}:${PUERTO_CAJA}.`,
        sugerencia:
          'Verifica en Ajustes que la IP sea la correcta, que la Caja esté abierta y que la tablet esté en el mismo Wi-Fi.',
      };

    case 'tls':
      return {
        causa: 'tls',
        estadoCorto: 'Conexión rechazada',
        titulo: 'La Caja rechazó la conexión',
        detalle: `Hay un equipo en ${ip}, pero no completó la conexión segura (HTTPS).`,
        sugerencia:
          'Reinicia la Caja. Si sigue igual, el certificado de la Caja cambió: reinstala el certificado nuevo o instala el APK más reciente.',
      };

    case 'token':
      return {
        causa: 'token',
        estadoCorto: 'Sin autorización',
        titulo: 'La tablet no está autorizada',
        detalle: 'La Caja respondió, pero rechazó la clave de esta app (401).',
        sugerencia:
          'Esta versión de la app se instaló sin la clave del sistema. Instala el APK más reciente.',
      };

    case 'servidor':
      return {
        causa: 'servidor',
        estadoCorto: 'Error de la Caja',
        titulo: 'Error en la Caja',
        detalle: `La Caja respondió con el código ${datos.status ?? 'de error'}.`,
        sugerencia: 'Reinicia la Caja y vuelve a intentar.',
      };

    default:
      return {
        causa: 'desconocido',
        estadoCorto: 'Error de conexión',
        titulo: 'No se pudo conectar',
        detalle: 'La Caja no respondió como se esperaba.',
        sugerencia: 'Reinicia la tablet y la Caja, y vuelve a intentar.',
      };
  }
};

/** Diagnóstico del caso correcto (para tests y para el estado "Conectado"). */
export const diagnosticoOk = (ip = ''): Diagnostico => construir('ok', { ip });

/** Construye el mensaje de una causa concreta (útil para la sonda de /api/status). */
export const diagnosticoDeCausa = (
  causa: CausaConexion,
  datos: { ip?: string; status?: number | null } = {},
): Diagnostico => construir(causa, datos);

/**
 * Clasifica un error de axios contra el backend.
 *
 * @param error objeto de error tal como lo entrega axios
 * @param ip    IP configurada en la tablet (para el mensaje)
 */
export const interpretarError = (error: any, ip = ''): Diagnostico => {
  const status = estadoHttp(error);

  // Respondió la Caja → el problema no es la red ni el certificado.
  if (status !== null) {
    if (status === 401 || status === 403) return construir('token', { ip });
    return construir('servidor', { ip, status });
  }

  // Sin respuesta: timeout = nadie escuchando; fallo inmediato = rechazó el HTTPS.
  if (esTimeout(error)) return construir('ip', { ip });
  return construir('tls', { ip });
};

/** Etiqueta corta de la causa, para mostrarla explícita en la pantalla. */
export const ETIQUETAS_CAUSA: Record<CausaConexion, string> = {
  ok: 'CONECTADO',
  ip: 'IP INCORRECTA O CAJA APAGADA',
  tls: 'CERTIFICADO O PUERTO 3001',
  token: 'CLAVE DE LA APP INVÁLIDA',
  servidor: 'ERROR DE LA CAJA',
  desconocido: 'ERROR DE CONEXIÓN',
};

export const etiquetaCausa = (causa: CausaConexion): string =>
  ETIQUETAS_CAUSA[causa] ?? ETIQUETAS_CAUSA.desconocido;

/** Texto de una sola cadena (para Alert.alert) a partir del diagnóstico. */
export const formatearDiagnostico = (d: Diagnostico): string => {
  if (d.causa === 'ok') return d.titulo;
  return `${d.titulo}\n${d.detalle}\n\n${d.sugerencia}`;
};
