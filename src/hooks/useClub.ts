// 🎫 Club Calletano — Hook del escáner de visitas (app del mozo)
// Flujo:
//   1. El mozo escanea el QR de la tarjeta (o ingresa el DNI a mano).
//   2. Buscamos al socio en Firestore: club_miembros/{documento} (lectura pública)
//   3. "SUMAR VISITA" registra la visita en el BACKEND local (POST /api/club/.../visita)
//      con token compartido. El backend valida en una transacción server-side
//      el anti-doble-visita (máximo 1 visita/día por sede) y actualiza el conteo.
//
// 🔐 SEGURIDAD (cambios de la sesión de mejoras críticas):
//   - Ya NO usamos login anónimo de Firebase para escribir: eso permitía que
//     cualquier app modificada sumara visitas ilimitadas. El registro ahora es
//     server-side y solo el backend (Admin SDK) escribe club_miembros/club_visitas.
//   - La lectura de la tarjeta sigue siendo pública (la web la usa igual).
import { useCallback, useRef, useState } from 'react';
import axios from 'axios';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase-config';
import { obtenerFechaActualLocal } from '../utils/helpers';
import {
  normalizarDocumento, validarDocumento, extraerCodigoTarjeta, esCodigoLegacy, yaRegistroVisitaHoy,
} from '../utils/club';

export type VistaClub = 'escanear' | 'tarjeta' | 'exito';

// ⚙️ Valores FIJOS del club (ya no se leen de Firestore clubConfig)
// 🎫 Diseño final (tarjeta única): 10 visitas → 1 plato de carta personal
const META_VISITAS = 10;
const PREMIO = '1 plato de carta personal';
const SEDE = 'Máncora';
// 💵 Consumo mínimo por boleta (tarjeta única): la visita se registra SOLO si la
// mesa llega a S/ 80 en COMIDA (menú + almuerzo de domingo + carta; sin bebidas
// ni envases). El backend lo valida igual (no se puede saltar desde la app).
export const CONSUMO_MINIMO = 80;

// 🛡️ Token compartido del Club — debe coincidir con CLUB_API_KEY del backend
const CLUB_API_KEY = 'calletano-club-key-2026';

export default function useClub(ipServidor: string = '') {
  const [modal, setModal] = useState(false);
  const [vista, setVista] = useState<VistaClub>('escanear');
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [miembro, setMiembro] = useState<any>(null);
  const [meta, setMeta] = useState(META_VISITAS);
  const [premio, setPremio] = useState(PREMIO);
  const [sede, setSede] = useState(SEDE);
  const [documentoManual, setDocumentoManual] = useState('');
  const [visitasNuevas, setVisitasNuevas] = useState(0);
  const [yaVisitoHoy, setYaVisitoHoy] = useState(false);
  // 💵 Consumo de comida de la mesa (S/) que el mozo confirma antes de sumar la visita
  const [consumoMesa, setConsumoMesa] = useState('');
  // Evita que la cámara dispare el escaneo repetidamente con el mismo QR
  const escaneandoRef = useRef(false);
  // Recuerda el último QR procesado para no repetir consultas a Firestore
  // mientras un QR sin tarjeta sigue en el visor de la cámara.
  const ultimoEscaneadoRef = useRef('');

  const resetearFlujo = useCallback(() => {
    setMensaje('');
    setMiembro(null);
    setDocumentoManual('');
    setCargando(false);
    setYaVisitoHoy(false);
    setConsumoMesa('');
    escaneandoRef.current = false;
    ultimoEscaneadoRef.current = '';
  }, []);

  const abrirClub = useCallback(() => {
    resetearFlujo();
    setVista('escanear');
    setModal(true);
  }, [resetearFlujo]);

  const cerrarClub = useCallback(() => {
    setModal(false);
    setCargando(false);
  }, []);

  const escanearOtro = useCallback(() => {
    resetearFlujo();
    setVista('escanear');
  }, [resetearFlujo]);

  // ── Busca la tarjeta del socio por documento (lectura pública) ──
  const buscarTarjeta = useCallback(
    async (documento: string) => {
      const docNum = normalizarDocumento(documento);
      if (!validarDocumento('AUTO', docNum)) {
        setVista('escanear');
        setMensaje('Documento no válido. Escanea el QR de la tarjeta o ingresa DNI/CE.');
        return;
      }
      setCargando(true);
      setMensaje('');
      try {
        const snap = await getDoc(doc(db, 'club_miembros', docNum));
        if (!snap.exists()) {
          setVista('escanear');
          setMensaje('Este cliente aún no tiene tarjeta del Club Calletano. Puede crearla gratis en calletano-restaurant.web.app/club-crear.html');
          return;
        }
        const d = snap.data() as any;
        const ultimaVisita = d.ultima_visita || {};
        setMiembro({
          nombre: d.nombre || 'Socio',
          documento: d.documento || docNum,
          tipo_documento: d.tipo_documento || 'DNI',
          visitas: parseInt(d.visitas, 10) || 0,
          ultima_visita: ultimaVisita,
        });
        setYaVisitoHoy(yaRegistroVisitaHoy(ultimaVisita, SEDE, obtenerFechaActualLocal()));
        setVista('tarjeta');
      } catch (e: any) {
        console.warn('Club: error al buscar tarjeta', e?.message);
        setVista('escanear');
        setMensaje('No se pudo consultar la tarjeta. Revisa la conexión a internet.');
      } finally {
        setCargando(false);
      }
    },
    [],
  );

  // ── Registra la visita VÍA BACKEND (anti-fraude server-side) ──
  // El backend valida en transacción el máximo 1 visita/día por sede y
  // actualiza club_miembros + club_visitas con el Admin SDK.
  const sumarVisita = useCallback(async () => {
    if (!miembro) return;
    setCargando(true);
    setMensaje('');

    // 💵 Mínimo de consumo: el mozo confirma el consumo de comida de la mesa
    // (el backend valida igual, esto es solo feedback inmediato en la tablet)
    const consumo = parseFloat(consumoMesa) || 0;
    if (consumo < CONSUMO_MINIMO) {
      setMensaje(`El consumo de comida de la mesa no llega al mínimo de S/ ${CONSUMO_MINIMO}.`);
      setCargando(false);
      return;
    }

    if (!ipServidor) {
      setMensaje('No hay conexión con la caja (IP). No se puede registrar la visita.');
      setCargando(false);
      return;
    }

    try {
      const res = await axios.post(
        `http://${ipServidor}:3001/api/club/miembros/${miembro.documento}/visita`,
        { sede, consumo_comida: consumo },
        { timeout: 8000, headers: { 'x-club-key': CLUB_API_KEY } },
      );

      const visitas = parseInt(res.data?.visitas, 10) || (miembro.visitas || 0) + 1;
      setVisitasNuevas(visitas);
      setYaVisitoHoy(true);
      setMiembro((prev: any) => (prev ? { ...prev, visitas } : prev));
      setVista('exito');
      // 🎁 El correo de "casi premio" lo envía el propio backend al llegar a meta-1
    } catch (e: any) {
      console.warn('Club: error al registrar visita (backend):', e?.message);
      const status = e?.response?.status;
      if (status === 409) {
        // 409 puede ser: consumo insuficiente (validado por el servidor) o
        // visita ya registrada hoy (anti-doble-visita). Leemos el mensaje real.
        // ⚠️ El desambiguador depende del texto del backend ("consumo"): se
        // mantiene a propósito porque el gate del cliente hace inalcanzable el
        // 409 de consumo desde esta UI (defensa en profundidad).
        const msg = String(e?.response?.data?.error || '');
        if (msg.includes('consumo')) {
          setMensaje(msg);
        } else {
          setYaVisitoHoy(true);
          setMensaje('El cliente ya registró su visita hoy.');
        }
      } else if (status === 404) {
        setVista('escanear');
        setMensaje('Este cliente ya no tiene tarjeta del club.');
      } else {
        setMensaje('No se pudo registrar la visita. Verifica la conexión con la caja.');
      }
    } finally {
      setCargando(false);
    }
  }, [miembro, sede, ipServidor, consumoMesa]);

  // ── Resuelve el código escaneado a la tarjeta del socio ──
  // 🔒 PRIVACIDAD: los QRs NUEVOS llevan un token opaco (club_tokens/{token} →
  // documento) para que el DNI no viaje por URLs. Los QRs LEGACY (documento
  // directo) siguen funcionando.
  const resolverTarjeta = useCallback(
    async (codigo: string) => {
      if (esCodigoLegacy(codigo)) {
        await buscarTarjeta(codigo);
        return;
      }
      try {
        const snapToken = await getDoc(doc(db, 'club_tokens', codigo));
        if (!snapToken.exists()) {
          setVista('escanear');
          setMensaje('Este código no corresponde a una tarjeta del Club Calletano.');
          return;
        }
        const documento = String((snapToken.data() as any)?.documento || '').replace(/[^0-9]/g, '');
        if (!validarDocumento('AUTO', documento)) {
          setVista('escanear');
          setMensaje('La tarjeta tiene un código inválido. Escanea el QR de nuevo.');
          return;
        }
        await buscarTarjeta(documento);
      } catch (e: any) {
        console.warn('Club: error al resolver el token de la tarjeta:', e?.message);
        setVista('escanear');
        setMensaje('No se pudo leer la tarjeta. Revisa la conexión a internet.');
      }
    },
    [buscarTarjeta],
  );

  // ── Procesa el texto escaneado por la cámara ──
  const procesarEscaneo = useCallback(
    (texto: string) => {
      if (escaneandoRef.current || vista !== 'escanear') return;
      const codigo = extraerCodigoTarjeta(texto);
      if (!codigo || codigo === ultimoEscaneadoRef.current) return; // QR ajeno al club o ya procesado
      escaneandoRef.current = true;
      ultimoEscaneadoRef.current = codigo;
      resolverTarjeta(codigo).finally(() => {
        // Pequeña pausa para no re-escannear el mismo QR al instante
        setTimeout(() => { escaneandoRef.current = false; }, 1200);
      });
    },
    [resolverTarjeta, vista],
  );

  return {
    modal, vista, cargando, mensaje, miembro, meta, premio, sede,
    documentoManual, setDocumentoManual, visitasNuevas, yaVisitoHoy,
    consumoMesa, setConsumoMesa,
    abrirClub, cerrarClub, escanearOtro, buscarTarjeta, sumarVisita, procesarEscaneo,
  };
}
