import { useState, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase-config';
import { CLUB_API_KEY } from '../lib/apiClient';
import { obtenerFechaActualLocal } from '../utils/helpers';
import {
  Diagnostico,
  diagnosticoDeCausa,
  interpretarError,
  limpiarIp,
} from '../utils/diagnostico';

type SysState = {
  ipServidor: string;
  ipInput: string;
  modoConfig: boolean;
  serverStatus: string;
  conectado: boolean;
  /** 🩺 Último fallo de conexión, ya explicado (IP / certificado / token). */
  diagnostico: Diagnostico | null;
};

export default function useAppSystem(onAdminLoginSuccess: () => void) {
  const [sys, setSys] = useState<SysState>({ ipServidor: '', ipInput: '', modoConfig: true, serverStatus: 'Sin conexión', conectado: false, diagnostico: null });
  const [authData, setAuthData] = useState({ usuarioActivo: null as any, username: '', password: '', error: '', errorDetalle: null as Diagnostico | null });
  
  // 🆕 Login con roles: 'dueno' | 'mozo' | null
  const [loginRole, setLoginRole] = useState<'dueno' | 'mozo' | null>(null);
  
  const [appData, setAppData] = useState({
    mesas: [], carta: [], modoDomingo: false,    estadoRestaurante: {apertura: 12, cierre: 22, cierreForzado: '', mesImpuestoPagado: '', modo_solo_carta: false},
    extrasStock: {} as Record<string, number>,
    // 🏆 Ranking "más pedidos" de la carta (lo calcula el backend en /api/mas-pedidos).
    masPedidos: [] as any[]
  });

  const socketRef = useRef<Socket | null>(null);

  // 🩺 Traduce un fallo de conexión en un mensaje concreto: IP equivocada,
  // certificado rechazado o tablet sin autorizar. El backend expone
  // GET /api/status SIN token — esa sonda separa la capa de red/TLS de la de
  // autorización, que era justo lo que antes quedaba todo bajo "Revisa IP".
  const diagnosticarConexion = async (API_URL: string, errorOriginal: any): Promise<Diagnostico> => {
    const ip = sys.ipServidor;

    // 1) Si la Caja alcanzó a responder, la red y el certificado están bien:
    //    el fallo es de autorización (401) o un error de la propia Caja.
    if (errorOriginal?.response) return interpretarError(errorOriginal, ip);

    // 2) Sin respuesta: sonda pública para saber si contestó alguien.
    try {
      await axios.get(`${API_URL}/api/status`, { timeout: 4000 });
      // Responde bien sin token → el fallo anterior fue momentáneo.
      return diagnosticoDeCausa('desconocido', { ip });
    } catch (errorSonda) {
      return interpretarError(errorSonda, ip);
    }
  };

  useEffect(() => {
    AsyncStorage.getItem('pos_ip').then(ip => {
      if (ip) setSys(prev => ({ ...prev, ipServidor: ip, ipInput: ip, modoConfig: false }));
    });
  }, []);

  useEffect(() => {
    if (!sys.ipServidor || sys.modoConfig) return;
    // 🔒 HTTPS: el backend escucha SOLO por TLS (certificado autofirmado). La
    // CA (tls/ca.crt del equipo de la caja) debe instalarse una vez en la
    // tablet: Settings → Seguridad → Instalar certificado → Certificado de CA.
    const API_URL = `https://${sys.ipServidor}:3001`;
    setSys(prev => ({ ...prev, serverStatus: 'Conectando...' }));
    
    // 🛡️ Socket.IO con autenticación: el handshake envía el token compartido
    // (el backend rechaza conexiones sin él — backend/middleware/socketAuth.js).
    socketRef.current = io(API_URL, { timeout: 4000, auth: { token: CLUB_API_KEY } });

    const cargarDatos = async () => {
      try {
        const [resMesas, resCarta, resDom, resExtras] = await Promise.all([
          axios.get(`${API_URL}/api/mesas`, { timeout: 4000 }),
          axios.get(`${API_URL}/api/carta`, { timeout: 4000 }),
          axios.get(`${API_URL}/api/modo-domingo`, { timeout: 4000 }),
          axios.get(`${API_URL}/api/extras-stock`, { timeout: 4000 })
        ]);
        
        // Uso la forma funcional para no pisar campos que se cargan por separado
        // (por ejemplo masPedidos, que se refresca cada 15 minutos).
        setAppData(prev => ({
          ...prev,
          mesas: resMesas.data,
          carta: resCarta.data,
          modoDomingo: resDom.data.modoDomingo,
          estadoRestaurante: resDom.data.estadoRestaurante || {apertura: 12, cierre: 22, cierreForzado: '', modo_solo_carta: false},
          extrasStock: resExtras.data || {}
        }));
        setSys(prev => ({ ...prev, serverStatus: 'Conectado', conectado: true, diagnostico: null }));
      } catch (error) {
        const diagnostico = await diagnosticarConexion(API_URL, error);
        setSys(prev => ({ ...prev, serverStatus: diagnostico.estadoCorto, conectado: false, diagnostico }));
      }
    };

    socketRef.current.on('connect', cargarDatos);
    socketRef.current.on('disconnect', () => setSys(prev => ({ ...prev, serverStatus: 'Desconectado', conectado: false })));
    socketRef.current.on('connect_error', () => { if (appData.mesas.length === 0) cargarDatos(); });
    socketRef.current.on('actualizar_mesas', cargarDatos);
    socketRef.current.on('cambio_estado_restaurante', (estado) => {
      setAppData(prev => ({ ...prev, estadoRestaurante: estado }));
      if (authData.usuarioActivo?.rol === 'admin' && onAdminLoginSuccess) onAdminLoginSuccess();
    });

    return () => { 
      if (socketRef.current) {
        socketRef.current.off('connect');
        socketRef.current.off('disconnect');
        socketRef.current.off('connect_error');
        socketRef.current.off('actualizar_mesas');
        socketRef.current.off('cambio_estado_restaurante');
        socketRef.current.disconnect(); 
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sys.ipServidor, sys.modoConfig, authData.usuarioActivo]);

  // 🏆 MÁS PEDIDOS: a diferencia de las mesas (que se refrescan en cada actualización
  // de pedidos), el ranking de ventas cambia lento. Lo cargo aparte y lo reviso cada
  // 15 minutos; el backend además lo tiene en cache.
  useEffect(() => {
    if (!sys.ipServidor || sys.modoConfig) return;
    const API_URL = `https://${sys.ipServidor}:3001`;
    let cancelado = false;

    const cargarMasPedidos = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/mas-pedidos`, { timeout: 6000 });
        if (!cancelado) setAppData(prev => ({ ...prev, masPedidos: res.data?.items || [] }));
      } catch {
        // El ranking es opcional: si falla, la sección simplemente no se muestra.
      }
    };

    cargarMasPedidos();
    const timer = setInterval(cargarMasPedidos, 15 * 60 * 1000);
    return () => { cancelado = true; clearInterval(timer); };
  }, [sys.ipServidor, sys.modoConfig]);

  const guardarIP = async () => {
    const ipLimpia = limpiarIp(sys.ipInput);
    if (!ipLimpia) return Alert.alert('Error', 'Ingresa una IP válida');
    await AsyncStorage.setItem('pos_ip', ipLimpia);
    setSys(prev => ({ ...prev, ipServidor: ipLimpia, modoConfig: false }));
  };

  // 🆕 Login simple para mozo (sin PIN)
  // 🔐 SEGURIDAD: ya NO envía credenciales hardcodeadas (caja/caja) por HTTP
  // plano — un sniffer de la LAN podría capturarlas. El rol del mozo es solo
  // de UI (se fuerza 'mozo' en el cliente), así que basta con verificar que la
  // caja responde: health-check contra /api/mesas (endpoint público de solo
  // lectura). El backend rechaza conexiones sin el token compartido, que ya
  // se inyecta vía el interceptor de apiClient.ts.
  const handleMozoLogin = async () => {
    setAuthData(prev => ({ ...prev, error: '' }));
    try {
      const API_URL = `https://${sys.ipServidor}:3001`;
      await axios.get(`${API_URL}/api/mesas`, { timeout: 3000 });
      // Forzar rol como mozo siempre
      setAuthData(prev => ({ ...prev, usuarioActivo: { username: 'Mozo', rol: 'mozo' } }));
    } catch (e: any) {
      const diagnostico = await diagnosticarConexion(`https://${sys.ipServidor}:3001`, e);
      setAuthData(prev => ({ ...prev, error: diagnostico.titulo, errorDetalle: diagnostico }));
    }
  };

  const handleLogin = async () => {
    setAuthData(prev => ({ ...prev, error: '' }));
    try {
      // 1. INTENTO LOCAL (Busca la Caja por Wi-Fi)
      const res = await axios.post(`https://${sys.ipServidor}:3001/api/login`, { username: authData.username, password: authData.password }, { timeout: 3000 });
      setAuthData(prev => ({ ...prev, usuarioActivo: res.data.user }));
      
      // 🟢 Si es admin, también autenticar con Firebase para poder leer Firestore (radar, reportes)
      if (res.data.user.rol === 'admin') {
        try {
          await signInWithEmailAndPassword(auth, 'admin@calletano.com', authData.password);
        } catch (_) {
          // No crítico: el radar/reporte fallarán pero la app de mozo funciona igual
        }
      }
      
      if (res.data.user.rol === 'admin') {
        if (onAdminLoginSuccess) onAdminLoginSuccess();
      }
    } catch (e) {
      // 2. ¿QUIÉN INTENTA ENTRAR? (Firebase para el Dueño)
      const usuarioEsAdmin = authData.username.toLowerCase() === 'admin' || authData.username.toLowerCase() === 'calletano';
      if (usuarioEsAdmin) {
        try {
          const correoRealAdmin = 'admin@calletano.com'; 
          await signInWithEmailAndPassword(auth, correoRealAdmin, authData.password);
          setAuthData(prev => ({ ...prev, usuarioActivo: { username: 'calletano', rol: 'admin' } }));
          
          const confSnap = await getDoc(doc(db, 'contenido', 'configuracion'));
          if (confSnap.exists()) setAppData(prev => ({ ...prev, estadoRestaurante: confSnap.data() as any }));
          
          if (onAdminLoginSuccess) onAdminLoginSuccess();
          if (socketRef.current) socketRef.current.disconnect();
          setSys(prev => ({ ...prev, serverStatus: 'Modo remoto ☁️', conectado: true }));
          Alert.alert('Modo Remoto Activado ☁️', 'Conectado a la nube de forma segura. Puedes gestionar tu negocio desde cualquier lugar.');
        } catch (errorFirebase: any) {
          if (errorFirebase.code === 'auth/network-request-failed') setAuthData(prev => ({ ...prev, error: 'Sin conexión a internet.' }));
          else if (errorFirebase.code === 'auth/wrong-password' || errorFirebase.code === 'auth/user-not-found' || errorFirebase.code === 'auth/invalid-credential') setAuthData(prev => ({ ...prev, error: 'Usuario o contraseña incorrectos en la nube.' }));
          else setAuthData(prev => ({ ...prev, error: 'Error al conectar con la nube.' }));
        }
      } else {
        setAuthData(prev => ({ ...prev, error: 'No se encuentra la Caja. Revisa el Wi-Fi o la IP.' }));
      }
    }
  };

  const toggleEstadoLocal = async () => {
    const hoy = obtenerFechaActualLocal();
    const estaCerrado = appData.estadoRestaurante.cierreForzado === hoy;
    const nuevoEstado = { ...appData.estadoRestaurante, cierreForzado: estaCerrado ? '' : hoy };
    try {
      await setDoc(doc(db, 'contenido', 'configuracion'), nuevoEstado, { merge: true });
      setAppData(prev => ({ ...prev, estadoRestaurante: nuevoEstado }));
      
      // 🛎️ Si hay conexión local, notificar al backend para que envíe push
      if (sys.ipServidor && !sys.serverStatus.includes('remoto')) {
        try {
          await axios.post(`https://${sys.ipServidor}:3001/api/admin/estado`, nuevoEstado, { timeout: 3000 });
        } catch (_) { /* El cambio ya se guardó en Firestore directo */ }
      }
      
      Alert.alert('Éxito', estaCerrado ? 'Restaurante ABIERTO' : 'Restaurante CERRADO');
    } catch(e) { Alert.alert('Error', 'No se pudo cambiar el estado en la nube'); }
  };

  return {
    sys, setSys, authData, setAuthData, appData, setAppData, socketRef,
    guardarIP, handleLogin, toggleEstadoLocal,
    // 🆕 Login con roles
    loginRole, setLoginRole, handleMozoLogin
  };
}