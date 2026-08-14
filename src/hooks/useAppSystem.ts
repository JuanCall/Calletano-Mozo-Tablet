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


export default function useAppSystem(onAdminLoginSuccess: () => void) {
  const [sys, setSys] = useState({ ipServidor: '', ipInput: '', modoConfig: true, serverStatus: 'Sin conexión', conectado: false });
  const [authData, setAuthData] = useState({ usuarioActivo: null as any, username: '', password: '', error: '' });
  
  // 🆕 Login con roles: 'dueno' | 'mozo' | null
  const [loginRole, setLoginRole] = useState<'dueno' | 'mozo' | null>(null);
  
  const [appData, setAppData] = useState({
    mesas: [], carta: [], modoDomingo: false,    estadoRestaurante: {apertura: 12, cierre: 22, cierreForzado: '', mesImpuestoPagado: ''},
    extrasStock: {} as Record<string, number>
  });

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('pos_ip').then(ip => {
      if (ip) setSys(prev => ({ ...prev, ipServidor: ip, ipInput: ip, modoConfig: false }));
    });
  }, []);

  useEffect(() => {
    if (!sys.ipServidor || sys.modoConfig) return;
    const API_URL = `http://${sys.ipServidor}:3001`;
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
        
        setAppData({
          mesas: resMesas.data,
          carta: resCarta.data,
          modoDomingo: resDom.data.modoDomingo,
          estadoRestaurante: resDom.data.estadoRestaurante || {apertura: 12, cierre: 22, cierreForzado: ''},
          extrasStock: resExtras.data || {}
        });
        setSys(prev => ({ ...prev, serverStatus: 'Conectado', conectado: true }));
      } catch {
        setSys(prev => ({ ...prev, serverStatus: 'Error · Revisa IP', conectado: false }));
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

  const guardarIP = async () => {
    const ipLimpia = sys.ipInput.trim();
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
      const API_URL = `http://${sys.ipServidor}:3001`;
      await axios.get(`${API_URL}/api/mesas`, { timeout: 3000 });
      // Forzar rol como mozo siempre
      setAuthData(prev => ({ ...prev, usuarioActivo: { username: 'Mozo', rol: 'mozo' } }));
    } catch (e: any) {
      setAuthData(prev => ({ ...prev, error: 'No se pudo conectar. Revisa la IP de la Caja.' }));
    }
  };

  const handleLogin = async () => {
    setAuthData(prev => ({ ...prev, error: '' }));
    try {
      // 1. INTENTO LOCAL (Busca la Caja por Wi-Fi)
      const res = await axios.post(`http://${sys.ipServidor}:3001/api/login`, { username: authData.username, password: authData.password }, { timeout: 3000 });
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
          await axios.post(`http://${sys.ipServidor}:3001/api/admin/estado`, nuevoEstado, { timeout: 3000 });
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