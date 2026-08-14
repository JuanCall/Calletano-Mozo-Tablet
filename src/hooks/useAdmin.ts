import { useState, useEffect, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { collection, doc, getDoc, getDocs, setDoc, query, where, orderBy, limit, Timestamp, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase-config';
import { obtenerFechaActualLocal, generarId, pad5 } from '../utils/helpers';
import { CLUB_API_KEY } from '../lib/apiClient';

const CACHE_TTL = 30 * 1000; // 30 segundos antes de re-fetchear (reporte diario)
const _CACHE_RADAR_TTL = 5 * 60 * 1000; // 5 minutos para el radar mensual (evita lecturas frecuentes)
const CACHE_RADAR_KEY = 'cache_radar_mensual';

const _MESES_ES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

export default function useAdmin(appData: any, setAppData: any, ipServidor: string = 'localhost') {
  const [admin, setAdmin] = useState({
    reporte: null as any, gastos: [] as any[], refreshing: false,
    radarMensual: null as any, // { ventasSunat, gastosSunat } del mes actual/mostrado
    radarMonth: obtenerFechaActualLocal().slice(0, 7), // "YYYY-MM" del mes seleccionado
    radarHistorial: {} as Record<string, { ventasSunat: number, gastosSunat: number }>, // cache en memoria
    modalMenu: false, menuData: { titulo: '', modoDomingo: false, entradas: [] as any[], segundos: [] as any[], refresco: '' },
    guarnicionGlobal: '',
    modalGasto: false, gastoData: { descripcion: '', monto: '', categoria: 'Insumos', con_comprobante: false },
    // 🆕 Contacto
    modalContacto: false, contactoData: { whatsapp: '', facebook: '', instagram: '' }
  });

  const ultimaActualizacion = useRef(0);
  const ultimaActualizacionRadar = useRef(0);
  const cacheFecha = useRef('');

  // 🟢 Cache: guardar reporte en AsyncStorage
  const guardarCacheReporte = async (reporte: any, gastos: any[]) => {
    try {
      const fecha = obtenerFechaActualLocal();
      const payload = JSON.stringify({ reporte, gastos, timestamp: Date.now(), fecha });
      await AsyncStorage.setItem('admin_cache_reporte', payload);
    } catch (e) { /* silencioso */ }
  };

  // 🟢 Cache: cargar reporte y radar desde AsyncStorage al montar
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('admin_cache_reporte');
        if (raw) {
          const cache = JSON.parse(raw);
          const hoy = obtenerFechaActualLocal();
          if (cache.fecha === hoy && cache.reporte && cache.gastos) {
            setAdmin(prev => ({ ...prev, reporte: cache.reporte, gastos: cache.gastos }));
            cacheFecha.current = hoy;
            ultimaActualizacion.current = cache.timestamp || 0;
          }
        }
      } catch (e) { /* silencioso */ }
      // Cargar radar mensual (usa su propio caché)
      cargarRadarTributario();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargarReporteDueño = async (forzar = false) => {
    try {
      // 🟢 Cache: si el cache es reciente, no re-fetcheamos
      const ahora = Date.now();
      if (!forzar && ultimaActualizacion.current > 0 && (ahora - ultimaActualizacion.current) < CACHE_TTL) {
        return;
      }

      const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0);
      const finDia = new Date(); finDia.setHours(23, 59, 59, 999);

      const qVentas = query(collection(db, 'ventas_historicas'), where('fecha', '>=', Timestamp.fromDate(inicioDia)), where('fecha', '<=', Timestamp.fromDate(finDia)));
      const ventasSnap = await getDocs(qVentas);
      
      const qGastos = query(collection(db, 'gastos'), where('fecha', '>=', Timestamp.fromDate(inicioDia)), where('fecha', '<=', Timestamp.fromDate(finDia)));
      const gastosSnap = await getDocs(qGastos);

      let totalV = 0; let ventasSunatHoy = 0; let cantBoletasSunat = 0;
      // 🆕 Detalle de cada boleta SUNAT (hora, mesa y monto)
      const boletasSunat: any[] = [];
      // 🆕 Desglose por método de pago
      let pagoEfectivo = 0, pagoYape = 0, pagoPlin = 0, pagoTarjeta = 0;
      ventasSnap.forEach(d => { 
          const data = d.data();
          totalV += data.total_cobrado || 0;
          const pg = data.metodos_pago || {};
          if (pg.enviado_sunat === true) {
              ventasSunatHoy += data.total_cobrado || 0;
              cantBoletasSunat += 1;
              // Hora local de la venta (la fecha se guarda como Timestamp de Firestore)
              let hora = '--:--';
              if (data.fecha && typeof data.fecha.toDate === 'function') {
                const dFecha = data.fecha.toDate();
                hora = `${String(dFecha.getHours()).padStart(2, '0')}:${String(dFecha.getMinutes()).padStart(2, '0')}`;
              }
              boletasSunat.push({
                hora,
                mesa: data.mesa || '',
                monto: data.total_cobrado || 0,
              });
          }
          // 🆕 Acumular método de pago (cada método se suma independientemente)
          if (pg.efectivo) pagoEfectivo += parseFloat(pg.efectivo) || 0;
          if (pg.yape) pagoYape += parseFloat(pg.yape) || 0;
          if (pg.plin) pagoPlin += parseFloat(pg.plin) || 0;
          if (pg.tarjeta) pagoTarjeta += parseFloat(pg.tarjeta) || 0;
      });
      // Ordenar por hora (más recientes primero)
      boletasSunat.sort((a, b) => String(b.hora).localeCompare(String(a.hora)));
      
      let totalG = 0; const listaG: any[] = [];
      gastosSnap.forEach(docSnap => { 
        const d = docSnap.data();
        totalG += d.monto || 0; 
        listaG.push({ id: docSnap.id, ...d });
      });

      const nuevoReporte = { 
        totales: { totalVentas: totalV, totalGastos: totalG, balance: totalV - totalG, ventasSunatHoy, cantBoletasSunat },
        pagos: { efectivo: pagoEfectivo, yape: pagoYape, plin: pagoPlin, tarjeta: pagoTarjeta },
        boletasSunat, // 🆕 Detalle de cada boleta SUNAT (hora, mesa, monto)
      };

      setAdmin(prev => ({ 
        ...prev, gastos: listaG, reporte: nuevoReporte
      }));

      // 🟢 Cache: guardar en AsyncStorage
      ultimaActualizacion.current = Date.now();
      cacheFecha.current = obtenerFechaActualLocal();
      guardarCacheReporte(nuevoReporte, listaG);
    } catch (e) { console.log("Error cargando reporte remoto", e); }
  };

  // 🟢 Radar Tributario: ventas y gastos CON COMPROBANTE del MES indicado
  // Cache de 5 minutos para no consumir lecturas en cada refresh
  const cargarRadarTributario = async (mes?: string, forzar = false) => {
    const mesTarget = mes || obtenerFechaActualLocal().slice(0, 7);
    
    try {
      // Si ya tenemos datos en historial y no forzamos, usarlos
      if (!forzar && admin.radarHistorial[mesTarget]) {
        setAdmin(prev => ({ ...prev, radarMensual: prev.radarHistorial[mesTarget] }));
        return;
      }

      // Parsear año/mes
      const [yearStr, monthStr] = mesTarget.split('-');
      const year = parseInt(yearStr);
      const month = parseInt(monthStr) - 1; // JS months 0-indexed

      // Inicio del mes
      const inicioMes = new Date(year, month, 1);
      inicioMes.setHours(0, 0, 0, 0);
      
      // Fin del mes (último día)
      const finMes = new Date(year, month + 1, 0);
      finMes.setHours(23, 59, 59, 999);

      // Ventas del mes con métodos que generan comprobante
      const qVentas = query(collection(db, 'ventas_historicas'), 
        where('fecha', '>=', Timestamp.fromDate(inicioMes)), 
        where('fecha', '<=', Timestamp.fromDate(finMes)));
      const ventasSnap = await getDocs(qVentas);
      let ventasSunat = 0;
      ventasSnap.forEach(d => {
        const pg = d.data().metodos_pago || {};
        if (pg.enviado_sunat === true || parseFloat(pg.plin) > 0 || parseFloat(pg.tarjeta) > 0) {
          ventasSunat += d.data().total_cobrado || 0;
        }
      });

      // Gastos del mes con comprobante
      const qGastos = query(collection(db, 'gastos'),
        where('fecha', '>=', Timestamp.fromDate(inicioMes)),
        where('fecha', '<=', Timestamp.fromDate(finMes)));
      const gastosSnap = await getDocs(qGastos);
      let gastosSunat = 0;
      gastosSnap.forEach(docSnap => {
        const d = docSnap.data();
        if (d.con_comprobante) gastosSunat += d.monto || 0;
      });

      const radarData = { ventasSunat, gastosSunat };
      
      setAdmin(prev => ({
        ...prev,
        radarMensual: radarData,
        radarHistorial: { ...prev.radarHistorial, [mesTarget]: radarData }
      }));
      ultimaActualizacionRadar.current = Date.now();

      // Cachear mes actual en AsyncStorage
      const mesActual = obtenerFechaActualLocal().slice(0, 7);
      if (mesTarget === mesActual) {
        await AsyncStorage.setItem(CACHE_RADAR_KEY, JSON.stringify({ [mesActual]: radarData }));
      }
    } catch (e: any) {
      // No mostrar error si es solo de permisos (ocurre antes del login)
      if (e?.code !== 'permission-denied') {
        console.log("Error cargando radar mensual", e);
      }
    }
  };

  // 🟢 Navegación de meses: -1 retrocede, +1 avanza
  const navegarMes = (delta: number) => {
    setAdmin(prev => {
      const [y, m] = prev.radarMonth.split('-');
      const d = new Date(parseInt(y), parseInt(m) - 1 + delta, 1);
      const nuevoMes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      
      if (prev.radarHistorial[nuevoMes]) {
        return { ...prev, radarMonth: nuevoMes, radarMensual: prev.radarHistorial[nuevoMes] };
      }
      cargarRadarTributario(nuevoMes, false);
      return { ...prev, radarMonth: nuevoMes };
    });
  };

  const eliminarGastoAdmin = (idGasto: string) => {
    if (Platform.OS === 'web') {
      if (window.confirm('¿Eliminar este registro permanentemente?')) {
        deleteDoc(doc(db, 'gastos', idGasto)).then(() => { 
          // 🟢 OPTIMIZADO: Mutar estado local en lugar de re-fetchear
          setAdmin(prev => {
            const nuevosGastos = prev.gastos.filter((g: any) => g.id !== idGasto);
            const gastoEliminado = prev.gastos.find((g: any) => g.id === idGasto);
            const nuevoTotalG = nuevosGastos.reduce((sum: number, g: any) => sum + (g.monto || 0), 0);
            const nuevoGastosSunat = nuevosGastos.filter((g: any) => g.con_comprobante).reduce((sum: number, g: any) => sum + (g.monto || 0), 0);
            const oldReporte = prev.reporte?.totales;
            const nuevoReporte = oldReporte ? {
              ...prev.reporte, // 🆕 preserva pagos y boletasSunat
              totales: {
                ...oldReporte,
                totalGastos: nuevoTotalG,
                gastosSunat: nuevoGastosSunat,
                balance: oldReporte.totalVentas - nuevoTotalG
              }
            } : prev.reporte;
            // ✅ Actualizar Radar Tributario al instante
            const oldRadar = prev.radarMensual;
            const nuevoRadar = oldRadar && gastoEliminado ? {
              ...oldRadar,
              gastosSunat: Math.max(0, oldRadar.gastosSunat - (gastoEliminado.con_comprobante ? gastoEliminado.monto : 0))
            } : oldRadar;
            guardarCacheReporte(nuevoReporte, nuevosGastos);
            return { ...prev, gastos: nuevosGastos, reporte: nuevoReporte, radarMensual: nuevoRadar };
          });
          Alert.alert('Éxito', 'Gasto eliminado.'); 
        }).catch(() => {});
      }
      return;
    }
    Alert.alert('Anular Gasto', '¿Eliminar este registro permanentemente?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'ELIMINAR', style: 'destructive', onPress: async () => {
        try { 
          await deleteDoc(doc(db, 'gastos', idGasto)); 
          // 🟢 OPTIMIZADO: Mutar estado local en lugar de re-fetchear
          setAdmin(prev => {
            const nuevosGastos = prev.gastos.filter((g: any) => g.id !== idGasto);
            const gastoEliminado = prev.gastos.find((g: any) => g.id === idGasto);
            const nuevoTotalG = nuevosGastos.reduce((sum: number, g: any) => sum + (g.monto || 0), 0);
            const nuevoGastosSunat = nuevosGastos.filter((g: any) => g.con_comprobante).reduce((sum: number, g: any) => sum + (g.monto || 0), 0);
            const oldReporte = prev.reporte?.totales;
            const nuevoReporte = oldReporte ? {
              ...prev.reporte, // 🆕 preserva pagos y boletasSunat
              totales: {
                ...oldReporte,
                totalGastos: nuevoTotalG,
                gastosSunat: nuevoGastosSunat,
                balance: oldReporte.totalVentas - nuevoTotalG
              }
            } : prev.reporte;
            // ✅ Actualizar Radar Tributario al instante
            const oldRadar = prev.radarMensual;
            const nuevoRadar = oldRadar && gastoEliminado ? {
              ...oldRadar,
              gastosSunat: Math.max(0, oldRadar.gastosSunat - (gastoEliminado.con_comprobante ? gastoEliminado.monto : 0))
            } : oldRadar;
            guardarCacheReporte(nuevoReporte, nuevosGastos);
            return { ...prev, gastos: nuevosGastos, reporte: nuevoReporte, radarMensual: nuevoRadar };
          });
          Alert.alert('Éxito', 'Gasto eliminado.'); 
        } catch (e) {}
      }}
    ]);
  };

  // ================================================================
  // 🟢 CONTADOR CACHEADO PARA ID DE GASTOS
  // ================================================================
  // La primera vez lee los últimos 50 docs de Firestore para sembrar.
  // Las siguientes veces usa AsyncStorage → 0 lecturas Firestore.
  // Si orderBy falla (falta índice), lee todos los docs UNA SOLA VEZ.
  // ================================================================
  const CACHE_ULTIMO_GASTO_KEY = 'cache_ultimo_numero_gasto';

  const sembrarUltimoNumeroGasto = async (): Promise<number> => {
    // 🟢 1. Leer últimos 50 docs ordenados por ID descendente (eficiente)
    try {
      const q = query(collection(db, 'gastos'), orderBy('__name__', 'desc'), limit(50));
      const snapshot = await getDocs(q);
      let maxNum = 0;
      snapshot.forEach(docSnap => {
        const match = docSnap.id.match(/^GAS-(\d{5})-/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      });
      await AsyncStorage.setItem(CACHE_ULTIMO_GASTO_KEY, String(maxNum));
      return maxNum;
    } catch (_) {
      // 🟡 2. Fallback: leer todos (solo UNA VEZ si falta índice)
      try {
        const snapshot = await getDocs(collection(db, 'gastos'));
        let maxNum = 0;
        snapshot.forEach(docSnap => {
          const match = docSnap.id.match(/^GAS-(\d{5})-/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
          }
        });
        await AsyncStorage.setItem(CACHE_ULTIMO_GASTO_KEY, String(maxNum));
        return maxNum;
      } catch (_) {
        return -1;
      }
    }
  };

  const obtenerUltimoNumeroGasto = async (): Promise<number> => {
    try {
      const cached = await AsyncStorage.getItem(CACHE_ULTIMO_GASTO_KEY);
      if (cached !== null) {
        const num = parseInt(cached, 10);
        if (!isNaN(num)) return num;
      }
      return await sembrarUltimoNumeroGasto();
    } catch (_) {
      return -1;
    }
  };

  const guardarGastoAdmin = async () => {
    if (!admin.gastoData.descripcion || !admin.gastoData.monto) return Alert.alert('Aviso', 'Ingresa un concepto y un monto.');
    
    const payload = {
      descripcion: admin.gastoData.descripcion,
      monto: parseFloat(admin.gastoData.monto),
      categoria: admin.gastoData.categoria || 'Otros',
      con_comprobante: admin.gastoData.con_comprobante === true
    };
    
    const fechaLimpia = obtenerFechaActualLocal().replace(/-/g, '');
    const fechaISO = new Date().toISOString();
    const gastoParaFirebase = {
      categoria: payload.categoria,
      concepto: payload.descripcion,
      monto: payload.monto,
      fecha: Timestamp.fromDate(new Date()),
      con_comprobante: payload.con_comprobante
    };
    
    // 🟢 1. Backend local (misma red) — SQLite auto-increment, 0 lecturas Firestore
    // ✅ Actualizar estado local inmediatamente para que se refleje en Radar y Gastos
    if (ipServidor && ipServidor !== 'localhost') {
      try {
        const res = await axios.post(`https://${ipServidor}:3001/api/gastos`, payload, { timeout: 3000 });
        // ✅ Construir gasto local para actualizar estado sin esperar refresh
        const firestoreId = res.data.firestoreId || `GAS-${Date.now().toString(36).toUpperCase()}-${fechaLimpia}`;
        const gastoLocal = {
          id: firestoreId,
          concepto: payload.descripcion,
          monto: payload.monto,
          categoria: payload.categoria,
          con_comprobante: payload.con_comprobante,
          fecha: new Date().toISOString()
        };
        setAdmin(prev => {
          const nuevosGastos = [gastoLocal, ...prev.gastos];
          const nuevoTotalG = nuevosGastos.reduce((sum, g) => sum + (g.monto || 0), 0);
          const nuevoGastosSunat = nuevosGastos.filter(g => g.con_comprobante).reduce((sum, g) => sum + (g.monto || 0), 0);
          const oldReporte = prev.reporte?.totales;
          const nuevoReporte = oldReporte ? {
            ...prev.reporte, // 🆕 preserva pagos y boletasSunat
            totales: {
              ...oldReporte,
              totalGastos: nuevoTotalG,
              gastosSunat: nuevoGastosSunat,
              balance: oldReporte.totalVentas - nuevoTotalG
            }
          } : prev.reporte;
          // ✅ Actualizar Radar Tributario al instante
          const oldRadar = prev.radarMensual;
          const nuevoRadar = oldRadar ? {
            ...oldRadar,
            gastosSunat: oldRadar.gastosSunat + (gastoLocal.con_comprobante ? gastoLocal.monto : 0)
          } : oldRadar;
          guardarCacheReporte(nuevoReporte, nuevosGastos);
          return {
            ...prev,
            gastos: nuevosGastos,
            reporte: nuevoReporte,
            radarMensual: nuevoRadar,
            gastoData: { descripcion: '', monto: '', categoria: 'Insumos', con_comprobante: false },
            modalGasto: false
          };
        });
        return Alert.alert('Éxito', 'Gasto registrado ✅');
      } catch (_) { /* intentar siguiente */ }
    }
    
    // 🟢 2. Contador cacheado en AsyncStorage — formato GAS-XXXXX-AAAAMMDD
    try {
      const ultimoNum = await obtenerUltimoNumeroGasto();
      if (ultimoNum >= 0) {
        // Intentar hasta 5 números adelante (por si el doc ya existe)
        for (let i = 1; i <= 5; i++) {
          const nextNum = ultimoNum + i;
          const idFirestore = `GAS-${pad5(nextNum)}-${fechaLimpia}`;
          
          const docRef = doc(db, 'gastos', idFirestore);
          const docSnap = await getDoc(docRef);
          
          if (!docSnap.exists()) {
            await setDoc(docRef, gastoParaFirebase);
            await AsyncStorage.setItem(CACHE_ULTIMO_GASTO_KEY, String(nextNum));
            
            const gastoLocal = { id: idFirestore, ...gastoParaFirebase, fecha: fechaISO };
            setAdmin(prev => {
              const nuevosGastos = [gastoLocal, ...prev.gastos];
              const nuevoTotalG = nuevosGastos.reduce((sum: number, g: any) => sum + (g.monto || 0), 0);
              const nuevoGastosSunat = nuevosGastos.filter((g: any) => g.con_comprobante).reduce((sum: number, g: any) => sum + (g.monto || 0), 0);
              const oldReporte = prev.reporte?.totales;
              const nuevoReporte = oldReporte ? {
                ...prev.reporte, // 🆕 preserva pagos y boletasSunat
                totales: {
                  ...oldReporte,
                  totalGastos: nuevoTotalG,
                  gastosSunat: nuevoGastosSunat,
                  balance: oldReporte.totalVentas - nuevoTotalG
                }
              } : prev.reporte;
              // ✅ Actualizar Radar Tributario al instante
              const oldRadar = prev.radarMensual;
              const nuevoRadar = oldRadar ? {
                ...oldRadar,
                gastosSunat: oldRadar.gastosSunat + (gastoLocal.con_comprobante ? gastoLocal.monto : 0)
              } : oldRadar;
              guardarCacheReporte(nuevoReporte, nuevosGastos);
              return { ...prev, gastos: nuevosGastos, reporte: nuevoReporte, radarMensual: nuevoRadar, gastoData: { descripcion: '', monto: '', categoria: 'Insumos', con_comprobante: false }, modalGasto: false };
            });
            return Alert.alert('Éxito', `Gasto registrado ☁️`);
          }
        }
      }
    } catch (_) { /* intentar fallback */ }
    
    // 🟡 3. Fallback: directo a Firestore (formato random)
    try {
      const timestamp = Date.now().toString(36).toUpperCase();
      const random = Math.random().toString(36).substring(2, 6).toUpperCase();
      const idFirestore = `GAS-${timestamp}${random}-${fechaLimpia}`;
      
      await setDoc(doc(db, 'gastos', idFirestore), gastoParaFirebase);
      
      const gastoLocal = { id: idFirestore, ...gastoParaFirebase, fecha: fechaISO };
      setAdmin(prev => {
        const nuevosGastos = [gastoLocal, ...prev.gastos];
        const nuevoTotalG = nuevosGastos.reduce((sum: number, g: any) => sum + (g.monto || 0), 0);
        const nuevoGastosSunat = nuevosGastos.filter((g: any) => g.con_comprobante).reduce((sum: number, g: any) => sum + (g.monto || 0), 0);
        const oldReporte = prev.reporte?.totales;
        const nuevoReporte = oldReporte ? {
          ...prev.reporte, // 🆕 preserva pagos y boletasSunat
          totales: {
            ...oldReporte,
            totalGastos: nuevoTotalG,
            gastosSunat: nuevoGastosSunat,
            balance: oldReporte.totalVentas - nuevoTotalG
          }
        } : prev.reporte;
        // ✅ Actualizar Radar Tributario al instante
        const oldRadar = prev.radarMensual;
        const nuevoRadar = oldRadar ? {
          ...oldRadar,
          gastosSunat: oldRadar.gastosSunat + (gastoLocal.con_comprobante ? gastoLocal.monto : 0)
        } : oldRadar;
        guardarCacheReporte(nuevoReporte, nuevosGastos);
        return { ...prev, gastos: nuevosGastos, reporte: nuevoReporte, radarMensual: nuevoRadar, gastoData: { descripcion: '', monto: '', categoria: 'Insumos', con_comprobante: false }, modalGasto: false };
      });
      
      Alert.alert('Aviso', 'Gasto guardado sin conexión ⚠️');
    } catch (_fallbackError: any) {
      Alert.alert('Error', 'No se pudo guardar en la nube. Intenta de nuevo.');
    }
  };

  const onRefreshAdmin = async () => {
    setAdmin(prev => ({ ...prev, refreshing: true }));
    await Promise.all([
      cargarReporteDueño(true),     // 🟢 forzar daily
      cargarRadarTributario(undefined, true)   // 🟢 forzar radar mensual
    ]);
    setAdmin(prev => ({ ...prev, refreshing: false }));
  };

  const abrirEditorMenu = async () => {
    try {
      const snap = await getDoc(doc(db, 'contenido', 'menuDiario'));
      if (snap.exists()) setAdmin(prev => ({ ...prev, menuData: snap.data() as any }));
      setAdmin(prev => ({ ...prev, modalMenu: true }));
    } catch (e) { Alert.alert('Error', 'No se pudo cargar el menú desde la nube'); }
  };

  const guardarAdminMenu = async () => {
    try {
      const dataLimpia = JSON.parse(JSON.stringify(admin.menuData));
      await setDoc(doc(db, 'contenido', 'menuDiario'), dataLimpia);
      setAppData((prev: any) => ({ ...prev, modoDomingo: admin.menuData.modoDomingo }));

      // 🚫 Notificaciones push a clientes desactivadas (decidido por el dueño)

      // 📧 El correo a los socios ya NO se envía al publicar el menú: sale UNA
      // vez al día a las 12:00 (job del backend). El endpoint /club/notificar-menu
      // es un no-op; lo mantenemos solo por compatibilidad (fire-and-forget).
      if (ipServidor) {
        axios
          .post(`https://${ipServidor}:3001/api/club/notificar-menu`, {}, { timeout: 5000, headers: { 'x-club-key': CLUB_API_KEY } })
          .catch(() => {
            // Silencioso: el correo es un extra, el menú ya quedó publicado
          });
      }

      setAdmin(prev => ({ ...prev, modalMenu: false }));
      Alert.alert('Éxito', 'Menú actualizado en la Nube ☁️');
    } catch (e: any) {      Alert.alert('Error', 'No se pudo guardar el menú. Intenta de nuevo.'); }
  };

  const updateAdminMenu = (updates: any) => setAdmin(prev => ({ ...prev, menuData: { ...prev.menuData, ...updates } }));
  
  const toggleDomingoAdmin = () => {
    setAdmin(p => {
      const nuevoEstado = !p.menuData.modoDomingo;
      const segundosActualizados = (p.menuData.segundos || []).map((s: any) => ({
          ...s, precio: nuevoEstado ? "30" : "16", taper: nuevoEstado ? ['grande'] : ['mediano']
      }));
      return { ...p, menuData: { ...p.menuData, modoDomingo: nuevoEstado, titulo: nuevoEstado ? 'ESPECIALES DE DOMINGO 🍽️' : 'MENU DEL DIA 🍽️', segundos: segundosActualizados } };
    });
  };

  const updateMenuArr = (tipo: string, idx: number, campo: string, valor: any) => {
    const arr = [...((admin.menuData as any)[tipo]||[])]; arr[idx][campo] = valor; updateAdminMenu({ [tipo]: arr });
  };

  const toggleTaperMenu = (type: string, idx: number, taperName: string) => {
     setAdmin(p => {
        const arr = [...(p.menuData as any)[type]]; const row = { ...arr[idx] }; 
        let tapersActuales = Array.isArray(row.taper) ? [...row.taper] : (row.taper ? [row.taper] : []);
        if (tapersActuales.includes(taperName)) tapersActuales = tapersActuales.filter(t => t !== taperName);
        else tapersActuales.push(taperName);
        row.taper = tapersActuales; arr[idx] = row;
        return { ...p, menuData: { ...p.menuData, [type]: arr } };
     });
  };

  const addMenuRow = (tipo: string) => setAdmin(p => {
    let precioDefecto = tipo === 'entradas' ? 6 : 16;
    let tapersDefecto = tipo === 'entradas' ? ['sopa'] : ['mediano'];
    if (tipo === 'segundos' && p.menuData.modoDomingo) { precioDefecto = 30; tapersDefecto = ['grande']; }
    const nuevaFila = tipo === 'entradas' ? { id: generarId(), nombre: '', precio: String(precioDefecto), taper: tapersDefecto, stock: '' } : { id: generarId(), nombre: '', acomp: '', precio: String(precioDefecto), taper: tapersDefecto, stock: '' };
    return { ...p, menuData: { ...p.menuData, [tipo]: [...((p.menuData as any)[tipo]||[]), nuevaFila] } };
  });

  const delMenuRow = (tipo: string, idx: number) => { const arr = [...(admin.menuData as any)[tipo]]; arr.splice(idx, 1); updateAdminMenu({ [tipo]: arr }); };

  const marcarImpuestoPagado = async () => {
    const mesActual = obtenerFechaActualLocal().slice(0, 7);
    const nuevoEstado = { ...appData.estadoRestaurante, mesImpuestoPagado: mesActual };
    try {
      await setDoc(doc(db, 'contenido', 'configuracion'), nuevoEstado, { merge: true });
      setAppData((prev: any) => ({ ...prev, estadoRestaurante: nuevoEstado }));
      Alert.alert('SUNAT', 'Impuesto marcado como pagado por este mes.');
    } catch(e) { }
  };

  // 🟢 Platos default para modo domingo (botones rápidos)
  const PLATOS_DEFAULT_DOMINGO = [
    { nombre: 'ARROZ CON PATO', acomp: '', precio: "30", taper: ['grande'], stock: '' },
    { nombre: 'COPUS DE CABRITO', acomp: '', precio: "30", taper: ['grande'], stock: '' },
    { nombre: 'CHANCHO AL PALO', acomp: '', precio: "30", taper: ['grande'], stock: '' },
    { nombre: 'TACACHO CON CECINA', acomp: '', precio: "30", taper: ['grande'], stock: '' },
    { nombre: 'PATO AL HORNO', acomp: '', precio: "30", taper: ['grande'], stock: '' },
    { nombre: 'CABRITO A LA NORTEÑA', acomp: '', precio: "30", taper: ['grande'], stock: '' },
  ];

  const addDefaultDomingoPlato = (nombrePlato: string) => {
    const plato = PLATOS_DEFAULT_DOMINGO.find(p => p.nombre === nombrePlato);
    if (!plato) return;
    setAdmin(p => {
      const segundos = [...(p.menuData.segundos || [])];
      const yaExiste = segundos.some((s: any) => s.nombre === nombrePlato);
      if (yaExiste) return p;
      segundos.push({ id: generarId(), ...plato });
      return { ...p, menuData: { ...p.menuData, segundos } };
    });
  };

  const aplicarGuarnicionGlobal = () => {
    if (!admin.guarnicionGlobal.trim()) return Alert.alert('Aviso', 'Escribe una guarnición primero.');
    const nuevosSegundos = (admin.menuData.segundos || []).map((s: any) => ({ ...s, acomp: admin.guarnicionGlobal }));
    updateAdminMenu({ segundos: nuevosSegundos });
    setAdmin(prev => ({ ...prev, guarnicionGlobal: '' }));
  };

  // ================================================================
  // 🆕 CONTACTO 📞
  // ================================================================
  const cargarContacto = async () => {
    try {
      const snap = await getDoc(doc(db, 'contenido', 'contacto'));
      if (snap.exists()) {
        const d = snap.data();
        setAdmin(prev => ({ ...prev, contactoData: {
          whatsapp: d.whatsapp || '',
          facebook: d.facebook || '',
          instagram: d.instagram || ''
        }}));
      }
    } catch (e) { console.log('Error cargando contacto:', e); }
  };

  const guardarContacto = async () => {
    try {
      await setDoc(doc(db, 'contenido', 'contacto'), {
        whatsapp: admin.contactoData.whatsapp,
        facebook: admin.contactoData.facebook,
        instagram: admin.contactoData.instagram
      });
      setAdmin(prev => ({ ...prev, modalContacto: false }));
      Alert.alert('✅', 'Contacto actualizado');
    } catch (e) { Alert.alert('Error', 'No se pudo guardar'); }
  };

  const abrirContacto = () => {
    cargarContacto();
    setAdmin(prev => ({ ...prev, modalContacto: true }));
  };

  return {
    admin, setAdmin, cargarReporteDueño, cargarRadarTributario, navegarMes, eliminarGastoAdmin, guardarGastoAdmin, onRefreshAdmin,
    abrirEditorMenu, guardarAdminMenu, updateAdminMenu, toggleDomingoAdmin, updateMenuArr, toggleTaperMenu,
    addMenuRow, delMenuRow, marcarImpuestoPagado, addDefaultDomingoPlato, PLATOS_DEFAULT_DOMINGO, aplicarGuarnicionGlobal,
    // 🆕 Contacto
    abrirContacto, guardarContacto
  };
}