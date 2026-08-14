// 🎫 Club Calletano — Gestión de socios (panel de la app del Dueño)
// - Lista todos los socios (club_miembros) con sus visitas acumuladas.
// - Botón "CANJEAR PREMIO": reinicia el contador de visitas a 0
//   (lo permite la regla de Firestore para isSystem: Dueño o Caja).
// - Pestaña "REPORTES": estadísticas del club (socios nuevos/mes, visitas/día,
//   % que llega al premio, premios entregados) vía backend /api/club/estadisticas.
// ⚙️ El club ya NO tiene configuración remota: la meta es FIJA (10 visitas).
import { useCallback, useState } from 'react';
import { Alert, Platform } from 'react-native';
import axios from 'axios';
import { collection, query, orderBy, limit, getDocs, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase-config';
import { obtenerFechaActualLocal } from '../utils/helpers';
import { calcularProgreso, filtrarSocios } from '../utils/club';

// ⚙️ Valores FIJOS del club (ya no se leen de Firestore clubConfig)
// 🎫 Diseño final (tarjeta única): 10 visitas para el premio
const META_VISITAS = 10;
const SEDE = 'Máncora';

// 🛡️ Token compartido del Club — debe coincidir con CLUB_API_KEY del backend
const CLUB_API_KEY = 'calletano-club-key-2026';

export default function useClubAdmin(ipServidor: string = '') {
  const [modal, setModal] = useState(false);
  const [miembros, setMiembros] = useState<any[]>([]);
  const [cargando, setCargando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [meta, setMeta] = useState(META_VISITAS);
  const [sede, setSede] = useState<string>(SEDE);
  const [premios, setPremios] = useState<any[]>([]);
  const [vistaLista, setVistaLista] = useState<'socios' | 'canjes' | 'reportes'>('socios');
  const [canjeando, setCanjeando] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<any>(null);
  const [cargandoStats, setCargandoStats] = useState(false);
  // 🎫 Registrar socio nuevo (validación RENIEC vía backend)
  const [nuevoDni, setNuevoDni] = useState('');
  const [registrando, setRegistrando] = useState(false);

  // ── Carga la lista de socios (la meta es fija: 10 visitas) ──
  const cargarSocios = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const miembrosSnap = await getDocs(collection(db, 'club_miembros'));
      setMeta(META_VISITAS);
      setSede(SEDE);

      const lista: any[] = [];
      miembrosSnap.forEach((d) => {
        const d2 = d.data() as any;
        lista.push({
          id: d.id,
          nombre: d2.nombre || 'Socio',
          tipo_documento: d2.tipo_documento || 'DNI',
          documento: d2.documento || d.id,
          visitas: parseInt(d2.visitas, 10) || 0,
          ultima_visita: d2.ultima_visita || {},
        });
      });
      // Ordenar de mayor a menor visitas (los que están por premiar arriba)
      lista.sort((a, b) => b.visitas - a.visitas);
      setMiembros(lista);
    } catch (e: any) {
      console.warn('ClubAdmin: no se pudieron cargar los socios', e?.message);
      // Mensaje en pantalla (sin Alert): evita popups molestos, por ejemplo
      // mientras las reglas de Firestore aún no se publican (permission-denied).
      setError('No se pudieron cargar los socios. Verifica la conexión.');
    } finally {
      setCargando(false);
    }
  }, []);

  // ── Carga el historial de premios canjeados (más recientes primero) ──
  const cargarPremios = useCallback(async () => {
    try {
      const snap = await getDocs(
        query(collection(db, 'premios_canjeados'), orderBy('fecha_local', 'desc'), limit(100)),
      );
      const lista: any[] = [];
      snap.forEach((d) => {
        const d2 = d.data() as any;
        lista.push({
          id: d.id,
          documento: d2.documento || '',
          nombre: d2.nombre || 'Socio',
          sede: d2.sede || '',
          fecha_local: d2.fecha_local || '',
          canjeado_por: d2.canjeado_por || '',
        });
      });
      // YYYY-MM-DD ordena bien como texto
      lista.sort((a, b) => String(b.fecha_local || '').localeCompare(String(a.fecha_local || '')));
      setPremios(lista);
    } catch (e: any) {
      console.warn('ClubAdmin: no se pudieron cargar los premios canjeados', e?.message);
    }
  }, []);

  // ── 📊 Carga las estadísticas del club (dashboard del Dueño) ──
  // Vienen del backend local /api/club/estadisticas (token compartido):
  //   socios_nuevos_por_mes, visitas_ultimos_14, pct_premio, premios_por_mes.
  const cargarEstadisticas = useCallback(async () => {
    if (!ipServidor) return;
    setCargandoStats(true);
    try {
      const res = await axios.get(`http://${ipServidor}:3001/api/club/estadisticas`, {
        timeout: 8000,
        headers: { 'x-club-key': CLUB_API_KEY },
      });
      setStats(res.data || null);
    } catch (e: any) {
      console.warn('ClubAdmin: no se pudieron cargar las estadísticas', e?.message);
      setStats(null);
    } finally {
      setCargandoStats(false);
    }
  }, [ipServidor]);

  // 🎫 Registrar socio nuevo: el backend valida el DNI contra RENIEC (ApisPeru)
  // y crea la tarjeta con el nombre oficial. La web pública NO valida RENIEC
  // (decisión del dueño): la validación vive en caja/tablet (LAN).
  const registrarSocio = useCallback(async () => {
    const docNum = String(nuevoDni || '').replace(/[^0-9]/g, '');
    if (docNum.length !== 8) {
      Alert.alert('DNI inválido', 'El DNI debe tener 8 dígitos, sin puntos ni guiones.');
      return;
    }
    if (!ipServidor) {
      Alert.alert('Sin conexión', 'Configura la IP de la caja para registrar socios.');
      return;
    }
    setRegistrando(true);
    try {
      const res = await axios.post(`http://${ipServidor}:3001/api/club/miembros`, { documento: docNum }, {
        timeout: 15000,
        headers: { 'x-club-key': CLUB_API_KEY },
      });
      const nombre = res.data?.miembro?.nombre || '';
      setNuevoDni('');
      cargarSocios();
      Alert.alert('🎫 Tarjeta creada', `${nombre} ya es socio del Club (DNI verificado en RENIEC).`);
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'No se pudo registrar al socio.';
      console.warn('ClubAdmin: error al registrar socio', msg);
      Alert.alert('Error', msg);
    } finally {
      setRegistrando(false);
    }
  }, [nuevoDni, ipServidor, cargarSocios]);

  const abrirSocios = useCallback(() => {
    setModal(true);
    setBusqueda('');
    setError('');
    setVistaLista('socios');
    cargarSocios();
    cargarPremios();
    cargarEstadisticas();
  }, [cargarSocios, cargarPremios, cargarEstadisticas]);

  const cerrarSocios = useCallback(() => {
    setModal(false);
    setCanjeando(null);
  }, []);

  // ── CANJEAR PREMIO: reinicia el contador de visitas a 0 ──
  // 🛡️ Defensa en profundidad (igual que el backend): el canje ocurre dentro
  // de una TRANSACCIÓN que relee la tarjeta y verifica la meta FIJA (10 visitas).
  // Si el socio ya no alcanza las visitas, se aborta el canje.
  const canjearPremio = useCallback((socio: any) => {
    if ((socio.visitas || 0) < meta) return; // guard rápido de la UI (el botón ya está deshabilitado)

    const confirmar = async () => {
      setCanjeando(socio.id);
      try {
        await runTransaction(db, async (tx) => {
          const ref = doc(db, 'club_miembros', socio.id);
          const miembroSnap = await tx.get(ref);
          if (!miembroSnap.exists()) {
            throw Object.assign(new Error('El socio ya no tiene tarjeta'), { code: 'club/sin-tarjeta' });
          }
          const visitasActual = parseInt((miembroSnap.data() as any)?.visitas, 10) || 0;
          if (visitasActual < META_VISITAS) {
            throw Object.assign(new Error('El socio ya no alcanza las visitas'), { code: 'club/meta-insuficiente' });
          }
          tx.update(ref, { visitas: 0 });
          // 📜 Historial: registra el premio canjeado (fecha, socio y sede)
          tx.set(doc(collection(db, 'premios_canjeados')), {
            documento: socio.documento || socio.id,
            nombre: socio.nombre || 'Socio',
            sede,
            fecha: serverTimestamp(),
            fecha_local: obtenerFechaActualLocal(),
            canjeado_por: 'Dueño',
          });
        });

        // Reinicia el contador y vuelve a ordenar (el socio canjeado baja en la lista)
        setMiembros(prev => prev
          .map(m => (m.id === socio.id ? { ...m, visitas: 0 } : m))
          .sort((a, b) => b.visitas - a.visitas));
        cargarPremios(); // refrescar el historial (incluye el premio recién canjeado)
        Alert.alert('🏆 Premio canjeado', `${socio.nombre} recibió su premio y su contador se reinició a 0 visitas.`);
      } catch (e: any) {
        console.warn('ClubAdmin: error al canjear premio', e?.message);
        if (e?.code === 'club/meta-insuficiente') {
          Alert.alert('Aviso', `${socio.nombre} ya no alcanza las visitas para el premio. Se actualizó la lista.`);
          cargarSocios(); // refrescar para mostrar el estado real
        } else {
          Alert.alert('Error', 'No se pudo canjear el premio. Intenta de nuevo.');
        }
      } finally {
        setCanjeando(null);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`¿Canjear el premio de ${socio.nombre}?\n\nEl contador de visitas se reiniciará a 0.`)) confirmar();
      return;
    }
    Alert.alert('Canjear Premio', `¿Entregar el premio a ${socio.nombre}?\n\nEl contador de visitas se reiniciará a 0.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'CANJEAR 🏆', style: 'destructive', onPress: confirmar },
    ]);
  }, [meta, sede, cargarSocios, cargarPremios]);

  const listaFiltrada = filtrarSocios(miembros, busqueda);
  const listosParaPremio = miembros.filter(m => (m.visitas || 0) >= meta).length;
  const progresoDe = (m: any) => calcularProgreso(m.visitas, meta);

  return {
    modal, miembros, cargando, busqueda, setBusqueda, meta, sede, premios,
    vistaLista, setVistaLista, canjeando, error, stats, cargandoStats,
    listaFiltrada, listosParaPremio, progresoDe,
    nuevoDni, setNuevoDni, registrando, registrarSocio,
    abrirSocios, cerrarSocios, cargarSocios, cargarPremios, cargarEstadisticas, canjearPremio,
  };
}
