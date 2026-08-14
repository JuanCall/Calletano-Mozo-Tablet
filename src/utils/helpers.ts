export const obtenerFechaActualLocal = () => {
    const tzOffset = new Date().getTimezoneOffset() * 60000;
    return new Date(Date.now() - tzOffset).toISOString().split('T')[0];
};

export const generarId = () => Math.random().toString(36).substring(2, 10);

export const pad5 = (num: number) => String(num).padStart(5, '0');

export const formatMesaName = (mesaId: string | null | undefined) => {
    if (!mesaId) return '';
    const str = String(mesaId);
    
    // Reglas para textos estructurados
    if (str.startsWith('mesa_')) return `MESA ${str.replace('mesa_', '')}`;
    if (str.startsWith('CTA-')) return `CUENTA: ${str.replace('CTA-', '').replace(/-/g, ' ')}`;
    if (str.startsWith('DEL-')) return `DELIVERY: ${str.replace('DEL-', '').replace(/-/g, ' ')}`;
    
    // 🟢 NUEVA REGLA: Si la Base de Datos devuelve un número puro (Ej: "1" o "1.0")
    if (!isNaN(parseFloat(str))) {
        return `MESA ${parseInt(str, 10)}`;
    }
    
    return str;
};

export const modLabelText = (mod: string) => {
    if (mod === 'local') return 'Local';
    if (mod === 'llevar') return 'Llevar';
    if (mod === 'delivery') return 'Delivery';
    if (mod === 'delivery_centro') return 'Centro';
    return mod;
};

// ── Obtener historial de cambios de platos desde el pedido ──
// Escanea los items del pedido buscando notas de ANULADO-CAMBIO y REEMPLAZA,
// las empareja y devuelve un array de cambios ordenados.
export const obtenerHistorialCambios = (pedido: any[]): Array<{
  platoOriginal: string;
  platoNuevo: string;
  categoria: string;
  fecha: string;
}> => {
  if (!pedido || pedido.length === 0) return [];

  const anulados = pedido.filter(i =>
    i.nota && i.nota.includes('ANULADO-CAMBIO A:')
  );
  const reemplazos = pedido.filter(i =>
    i.nota && i.nota.includes('REEMPLAZA A:')
  );

  const historial: Array<{
    platoOriginal: string;
    platoNuevo: string;
    categoria: string;
    fecha: string;
  }> = [];

  for (const anulado of anulados) {
    const matchAnul = anulado.nota.match(/ANULADO-CAMBIO A:\s*(.+?)(?:\s*\||$)/i);
    const nombreNuevo = matchAnul ? matchAnul[1].trim() : null;
    if (!nombreNuevo) continue;
    historial.push({
      platoOriginal: anulado.nombre,
      platoNuevo: nombreNuevo,
      categoria: anulado.categoria || '',
      fecha: anulado.fecha_agregado || ''
    });
  }

  for (const reemplazo of reemplazos) {
    const matchReem = reemplazo.nota.match(/REEMPLAZA A:\s*(.+?)(?:\s*\||$)/i);
    const nombreOriginal = matchReem ? matchReem[1].trim() : null;
    if (!nombreOriginal) continue;
    const yaExiste = historial.some(h => h.platoOriginal === nombreOriginal && h.platoNuevo === reemplazo.nombre);
    if (!yaExiste) {
      historial.push({
        platoOriginal: nombreOriginal,
        platoNuevo: reemplazo.nombre,
        categoria: reemplazo.categoria || '',
        fecha: reemplazo.fecha_agregado || ''
      });
    }
  }

  return historial.sort((a, b) => {
    if (a.fecha > b.fecha) return -1;
    if (a.fecha < b.fecha) return 1;
    return 0;
  });
};