// ============================================================
// 🎫 Club Calletano — Re-export tipado (GENERADO)
// ============================================================
// ⚠️ NO editar a mano: este archivo se genera con `npm run sync:club`
// desde la fuente única shared/club-core.js.
// Exporta las funciones puras con sus firmas TypeScript, delegando la
// implementación en club-core.js (ESM puro).
import * as core from './club-core';

export const normalizarDocumento: (input: string | null | undefined) => string = core.normalizarDocumento;
export const validarDocumento: (tipo: string, documento: string | null | undefined) => boolean = core.validarDocumento;
export const enmascararDocumento: (documento: string | null | undefined) => string = core.enmascararDocumento;
export const generarTokenTarjeta: (longitud?: number) => string = core.generarTokenTarjeta;
export const esCodigoLegacy: (codigo: string | null | undefined) => boolean = core.esCodigoLegacy;
export const esTokenValido: (codigo: string | null | undefined) => boolean = core.esTokenValido;
export const extraerCodigoTarjeta: (texto: string | null | undefined) => string | null = core.extraerCodigoTarjeta;
export const extraerDocumentoDeQR: (texto: string | null | undefined) => string | null = core.extraerDocumentoDeQR;
export const construirUrlTarjeta: (codigo: string | null | undefined, base?: string) => string = core.construirUrlTarjeta;
export const calcularProgreso: (visitas: number | string | null | undefined, meta: number | string | null | undefined) => { visitas: number; meta: number; restantes: number; porcentaje: number; completado: boolean } = core.calcularProgreso;
export const yaRegistroVisitaHoy: (ultimaVisita: Record<string, string> | null | undefined, sede: string, hoy: string) => boolean = core.yaRegistroVisitaHoy;
export const filtrarSocios: (miembros: any[], busqueda: string) => any[] = core.filtrarSocios;
