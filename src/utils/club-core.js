// ============================================================
// 🎫 Club Calletano — Funciones puras (GENERADO)
// ============================================================
// ⚠️ NO editar a mano: este archivo se genera con `npm run sync:club`
// desde la fuente única shared/club-core.js.
// Espejo de calletano-web/public/js/clubHelpers.js
export const CLUB_CONFIG = {
    nombre_club: 'Club Calletano',
    sedes: ['Máncora'],
    sede: 'Máncora',
    visitas_para_premio: 10,
    premio: '1 plato de carta personal',
    consumo_minimo: 80,
    condiciones: 'La visita se registra cuando tu boleta suma S/ 80 o más (menú del día, almuerzo de domingo o platos de carta; bebidas y envases no suman). Cuando la mesa llega al mínimo, una persona de la mesa registra su visita. Máximo 1 visita por día.',
};

// Página web donde el socio consulta su progreso (destino del QR).
export const PAGINA_CONSULTA = 'club-consultar.html';

// ── Normaliza un documento: quita puntos, guiones y espacios ──
export function normalizarDocumento(input) {
    return String(input == null ? '' : input)
        .replace(/[\s.\-]/g, '')
        .trim()
        .toUpperCase();
}

// ── Valida según tipo: DNI = 8 dígitos, CE = 9 a 12 dígitos ──
// 'AUTO' acepta cualquiera de los dos formatos (útil para escanear QR).
export function validarDocumento(tipo, documento) {
    const doc = normalizarDocumento(documento);
    if (!/^\d+$/.test(doc)) return false;
    if (tipo === 'CE') return doc.length >= 9 && doc.length <= 12;
    if (tipo === 'AUTO') return doc.length === 8 || (doc.length >= 9 && doc.length <= 12);
    return doc.length === 8; // DNI (default)
}

// ── Enmascara un documento para mostrar solo los últimos 4 dígitos ──
// Ej: '12345678' → '****5678' (privacy: el número completo nunca se muestra)
export function enmascararDocumento(documento) {
    const doc = String(documento == null ? '' : documento);
    if (doc.length <= 4) return doc;
    return '****' + doc.slice(-4);
}

// ── ¿El código del link es legacy (documento DNI/CE directo)? ──
// Los QRs antiguos codifican el documento; los nuevos codifican un token opaco.
export function esCodigoLegacy(codigo) {
    return /^\d{8,12}$/.test(String(codigo == null ? '' : codigo).trim());
}

// ── Extrae el CÓDIGO de la tarjeta (token o documento) desde el QR ──
// El QR codifica una URL tipo: .../club-consultar.html?club=<token>
// También acepta texto plano (token o documento).
export function extraerCodigoTarjeta(texto) {
    if (!texto) return null;
    const str = String(texto).trim();

    // 1) Buscar el parámetro club= en una URL (token A-Z0-9 o documento legacy)
    const matchParam = str.match(/[?&]club=([A-Za-z0-9]{8,40})/i);
    if (matchParam) {
        const codigo = matchParam[1].toUpperCase();
        return esCodigoLegacy(codigo) || esTokenValido(codigo) ? codigo : null;
    }

    // 2) Texto plano: se quedan solo caracteres alfanuméricos (token o documento)
    const codigo = str.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (esCodigoLegacy(codigo) || esTokenValido(codigo)) return codigo;

    return null;
}

// ── Genera un TOKEN opaco de tarjeta (A-Z, 0-9) ──
// 🔒 PRIVACIDAD: el link/QR de la tarjeta usa un token aleatorio en lugar del
// documento, para que el DNI/CE no viaje por URLs ni QRs. Entropía: 36^20 ≈
// 103 bits (no adivinable). Garantiza al menos una letra Y un dígito para
// distinguirlo tanto de un documento legacy (solo dígitos) como de texto
// basura (solo letras).
export function generarTokenTarjeta(longitud = 20) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digitos = '0123456789';
    const n = Math.max(8, Math.min(40, longitud));
    const bytes = new Uint32Array(n);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 0x100000000);
    }
    let token = '';
    for (let i = 0; i < n; i++) token += charset[bytes[i] % charset.length];
    // Garantías: al menos una letra y al menos un dígito.
    if (!/[A-Z]/.test(token)) token = letras[token.length % letras.length] + token.slice(1);
    if (!/[0-9]/.test(token)) token = token.slice(0, -1) + digitos[token.length % digitos.length];
    return token;
}

// ── ¿El código es un TOKEN opaco válido? (A-Z0-9 con letra Y dígito) ──
// Un token generado siempre pasa; el texto basura (solo letras o solo dígitos
// fuera del rango legacy) no.
export function esTokenValido(codigo) {
    const c = String(codigo == null ? '' : codigo).toUpperCase();
    if (!/^[A-Z0-9]{8,40}$/.test(c)) return false;
    if (esCodigoLegacy(c)) return false; // solo dígitos 8-12 es documento, no token
    return /[A-Z]/.test(c) && /[0-9]/.test(c);
}

// ── Extrae el documento desde el contenido de un QR LEGACY ──
// (QRs antiguos que codifican el DNI/CE directamente). Los QRs nuevos usan
// token opaco: extraerCodigoTarjeta + resolver contra club_tokens.
export function extraerDocumentoDeQR(texto) {
    if (!texto) return null;
    const str = String(texto).trim();

    // 1) Buscar el parámetro club= en una URL
    const matchParam = str.match(/[?&]club=([0-9]{8,12})/i);
    if (matchParam) {
        const doc = normalizarDocumento(matchParam[1]);
        return validarDocumento('AUTO', doc) ? doc : null;
    }

    // 2) Texto plano: solo dígitos
    const soloDigitos = str.replace(/[^\d]/g, '');
    if (validarDocumento('AUTO', soloDigitos)) return soloDigitos;

    return null;
}

// ── Construye la URL que lleva a la tarjeta del socio ──
// El QR apunta a la página de consulta del club con el CÓDIGO de la tarjeta
// (token opaco nuevo o documento legacy) como parámetro.
export function construirUrlTarjeta(codigo, base) {
    const origen = (base || 'https://calletano-restaurant.web.app').replace(/\/$/, '');
    return `${origen}/${PAGINA_CONSULTA}?club=${normalizarDocumento(codigo)}`;
}

// ── Calcula el progreso hacia el premio ──
// Devuelve: { visitas, meta, restantes, porcentaje, completado }
export function calcularProgreso(visitas, meta) {
    const v = Math.max(0, parseInt(visitas, 10) || 0);
    const m = Math.max(0, parseInt(meta, 10) || 0);
    const restantes = Math.max(0, m - v);
    const porcentaje = m > 0 ? Math.min(100, Math.round((v / m) * 100)) : 0;
    return {
        visitas: v,
        meta: m,
        restantes,
        porcentaje,
        completado: m > 0 && v >= m,
    };
}

// ── ¿El socio ya registró visita HOY en esta sede? ──
// ultima_visita es un mapa por sede: { 'Máncora': '2026-07-31' }
export function yaRegistroVisitaHoy(ultimaVisita, sede, hoy) {
    if (!ultimaVisita) return false;
    return (ultimaVisita[sede] || '') === hoy;
}

// ── Filtra la lista de socios por nombre, documento o tipo de documento ──
// (útil para el panel de socios de la app del Dueño)
export function filtrarSocios(miembros, busqueda) {
    const q = String(busqueda || '').trim().toLowerCase();
    if (!q) return miembros;
    return miembros.filter(m =>
        String(m.nombre || '').toLowerCase().includes(q) ||
        String(m.documento || '').toLowerCase().includes(q) ||
        String(m.tipo_documento || '').toLowerCase().includes(q),
    );
}
