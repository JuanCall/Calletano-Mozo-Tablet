import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, TextInput, ScrollView,
  StyleSheet, Alert, Modal, Platform,
  StatusBar as RNStatusBar, Dimensions, Animated, KeyboardAvoidingView, BackHandler, RefreshControl, Pressable, PanResponder
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io } from 'socket.io-client';
import axios from 'axios';
import { collection, doc, getDoc, getDocs, setDoc, addDoc, query, where, Timestamp, deleteDoc, orderBy, limit } from 'firebase/firestore';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { db, auth } from './_firebase-config';
import { StatusBar } from 'expo-status-bar';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';

const { width: SW } = Dimensions.get('window');

// ── Paleta Corporativa ERP ─────────────────────
const C = {
  bg:          '#F4F1ED',
  surface:     '#FFFFFF',
  primary:     '#120B06',
  primarySoft: 'rgba(18, 11, 6, 0.05)',
  gold:        '#D4A843',
  goldSoft:    'rgba(212, 168, 67, 0.12)',
  danger:      '#D7263D',
  dangerSoft:  '#FDE8E8',
  success:     '#10B981',
  successSoft: 'rgba(16, 185, 129, 0.12)',
  textDark:    '#2D241E',
  textMuted:   '#8A7060',
  border:      '#E5E0D8',
  borderFocus: '#D1C9C0',
  overlay:     'rgba(18, 11, 6, 0.7)',
  white:       '#FFFFFF',
};

// ─── COMPONENTES PUROS EXTRAÍDOS (Solución a anidación) ───
const ModIcon = ({ mod, color }) => {
  if (mod === 'local') return <MaterialCommunityIcons name="silverware-fork-knife" size={16} color={color} />;
  if (mod === 'llevar') return <Feather name="shopping-bag" size={16} color={color} />;
  return <MaterialCommunityIcons name="motorbike" size={18} color={color} />;
};

const modLabelText = (mod) => {
  if (mod === 'local') return 'Local';
  if (mod === 'llevar') return 'Llevar';
  if (mod === 'delivery') return 'Delivery';
  if (mod === 'delivery_centro') return 'Centro';
  return mod;
};

const generarId = () => Math.random().toString(36).substring(2, 10);

// ─── REMPLAZO MODERNO DE TOUCHABLE OPACITY ───
const Touchable = ({ style, activeOpacity = 0.7, children, disabled, onPress, hitSlop }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    hitSlop={hitSlop}
    style={({ pressed }) => {
      const baseStyle = typeof style === 'function' ? style({ pressed }) : style;
      return [baseStyle, { opacity: pressed && !disabled ? activeOpacity : (disabled ? 0.5 : 1) }];
    }}
  >
    {children}
  </Pressable>
);

export default function App() {
  // ─── ESTADOS AGRUPADOS (Solución a 32 useStates) ───
  const [sys, setSys] = useState({ ipServidor: '', ipInput: '', modoConfig: true, serverStatus: 'Sin conexión', conectado: false });
  const [authData, setAuthData] = useState({ usuarioActivo: null, username: '', password: '', error: '' });
  
  // Estado general de datos sincronizados
  const [appData, setAppData] = useState({
    mesas: [], carta: [], modoDomingo: false, estadoRestaurante: {apertura: 12, cierre: 22, cierreForzado: ''}
  });

  // Estado del mozo
  const [mozo, setMozo] = useState({ vistaActual: 'mesas', mesaActiva: null, filtroCarta: '' });
  const [carrito, setCarrito] = useState([]);
  const [cartVisible, setCartVisible] = useState(false);
  const [uiSplit, setUiSplit] = useState({ visible: false, idx: null, nextMod: '', cantidadTotal: 0, cantidadMover: 1 });
  
  // Modales
  const [ui, setUi] = useState({
    modalNota: false, notaInput: '', itemEditando: null, notaCantidadMover: 1,
    modalFueraCarta: false, fueraCartaItem: { id: '', nombre: '', precio: '' },
    modalDelivery: false, datosDelivery: { nombre: '', direccion: '', telefono: '', idx: null, mod: '' }
  });

  // Estado Admin
  const [admin, setAdmin] = useState({
    reporte: null, gastos: [], refreshing: false,
    modalMenu: false, menuData: { titulo: '', modoDomingo: false, entradas: [], segundos: [], refresco: '' },
    guarnicionGlobal: '',
    modalGasto: false, gastoData: { descripcion: '', monto: '', categoria: 'Insumos' }
  });

  const socketRef = useRef(null);

  const obtenerFechaActualLocal = () => {
    const tzOffset = new Date().getTimezoneOffset() * 60000;
    return new Date(Date.now() - tzOffset).toISOString().split('T')[0];
  };

  useEffect(() => {
    AsyncStorage.getItem('pos_ip').then(ip => {
      if (ip) setSys(prev => ({ ...prev, ipServidor: ip, ipInput: ip, modoConfig: false }));
    });
  }, []);

  useEffect(() => {
    const backAction = () => {
      if (authData.usuarioActivo && authData.usuarioActivo.rol !== 'admin' && mozo.vistaActual === 'comandar') {
        setMozo(prev => ({ ...prev, vistaActual: 'mesas' }));
        return true; 
      }
      return false; 
    };
    
    // 🟢 Asignamos el evento a una variable
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    
    // 🟢 Usamos la forma nativa correcta de limpiar en React Native
    return () => backHandler.remove(); 
  }, [mozo.vistaActual, authData.usuarioActivo]);

  useEffect(() => {
    if (!sys.ipServidor || sys.modoConfig) return;
    const API_URL = `http://${sys.ipServidor}:3001`;
    setSys(prev => ({ ...prev, serverStatus: 'Conectando...' }));
    
    socketRef.current = io(API_URL, { timeout: 4000 });

    const cargarDatos = async () => {
      try {
        const [resMesas, resCarta, resDom] = await Promise.all([
          axios.get(`${API_URL}/api/mesas`, { timeout: 4000 }),
          axios.get(`${API_URL}/api/carta`, { timeout: 4000 }),
          axios.get(`${API_URL}/api/modo-domingo`, { timeout: 4000 })
        ]);
        
        // 🟢 Solución a "Cascading SetState" agrupando en un solo setter
        setAppData({
          mesas: resMesas.data,
          carta: resCarta.data,
          modoDomingo: resDom.data.modoDomingo,
          estadoRestaurante: resDom.data.estadoRestaurante || {apertura: 12, cierre: 22, cierreForzado: ''}
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
      if (authData.usuarioActivo?.rol === 'admin') cargarReporteDueño();
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
  }, [sys.ipServidor, sys.modoConfig, authData.usuarioActivo]);

  // 🟢 DETECTOR DE ARRASTRE HACIA ABAJO (TELÓN)
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderRelease: (e, gestureState) => {
        // Si el mozo desliza el dedo hacia abajo más de 50 píxeles, cerramos el telón
        if (gestureState.dy > 50) setCartVisible(false);
      }
    })
  ).current;

  // ─── FUNCIONES GENERALES ───
  const guardarIP = async () => {
    const ipLimpia = sys.ipInput.trim();
    if (!ipLimpia) return Alert.alert('Error', 'Ingresa una IP válida');
    await AsyncStorage.setItem('pos_ip', ipLimpia);
    setSys(prev => ({ ...prev, ipServidor: ipLimpia, modoConfig: false }));
  };

  const handleLogin = async () => {
    setAuthData(prev => ({ ...prev, error: '' }));
    try {
      // 1. INTENTO LOCAL (Busca la Caja por Wi-Fi)
      const res = await axios.post(`http://${sys.ipServidor}:3001/api/login`, { 
        username: authData.username, 
        password: authData.password 
      }, { timeout: 3000 });
      
      setAuthData(prev => ({ ...prev, usuarioActivo: res.data.user }));
      if (res.data.user.rol === 'admin') cargarReporteDueño();
      
    } catch (e) {
      // 2. ¿QUIÉN INTENTA ENTRAR?
      const usuarioEsAdmin = authData.username.toLowerCase() === 'admin' || authData.username.toLowerCase() === 'calletano';
      
      if (usuarioEsAdmin) {
        // ES EL DUEÑO: Intentamos por la Nube (Firebase)
        try {
          const correoRealAdmin = 'admin@calletano.com'; 
          await signInWithEmailAndPassword(auth, correoRealAdmin, authData.password);
          
          setAuthData(prev => ({ ...prev, usuarioActivo: { username: 'calletano', rol: 'admin' } }));
          
          const confSnap = await getDoc(doc(db, 'contenido', 'configuracion'));
          if (confSnap.exists()) setAppData(prev => ({ ...prev, estadoRestaurante: confSnap.data() }));
          
          cargarReporteDueño();
          if (socketRef.current) socketRef.current.disconnect();
          setSys(prev => ({ ...prev, serverStatus: 'Modo remoto ☁️', conectado: true }));
          Alert.alert('Modo Remoto Activado ☁️', 'Conectado a Firebase de forma segura.');

        } catch (errorFirebase) {
          if (errorFirebase.code === 'auth/network-request-failed') setAuthData(prev => ({ ...prev, error: 'Sin conexión a internet.' }));
          else if (errorFirebase.code === 'auth/wrong-password' || errorFirebase.code === 'auth/user-not-found' || errorFirebase.code === 'auth/invalid-credential') setAuthData(prev => ({ ...prev, error: 'Usuario o contraseña incorrectos en la nube.' }));
          else setAuthData(prev => ({ ...prev, error: 'Error al conectar con la Nube.' }));
        }
      } else {
        // ES EL MOZO: Falló la red local, le mostramos el error real
        setAuthData(prev => ({ ...prev, error: 'No se encuentra la Caja. Revisa el Wi-Fi o la IP.' }));
      }
    }
  };

  const cerrarSesion = () => {
    setAuthData(prev => ({ ...prev, usuarioActivo: null, username: '', password: '' }));
    setMozo(prev => ({ ...prev, vistaActual: 'mesas' }));
  };

  // ─── FUNCIONES DEL DUEÑO ───
  const cargarReporteDueño = async () => {
    try {
      // 🟢 1. Fechas nativas exactas
      const inicioDia = new Date();
      inicioDia.setHours(0, 0, 0, 0);

      const finDia = new Date();
      finDia.setHours(23, 59, 59, 999);

      const qVentas = query(collection(db, 'ventas_historicas'), 
          where('fecha', '>=', Timestamp.fromDate(inicioDia)),
          where('fecha', '<=', Timestamp.fromDate(finDia))
      );
      const ventasSnap = await getDocs(qVentas);
      
      const qGastos = query(collection(db, 'gastos'), 
          where('fecha', '>=', Timestamp.fromDate(inicioDia)),
          where('fecha', '<=', Timestamp.fromDate(finDia))
      );
      const gastosSnap = await getDocs(qGastos);

      let totalV = 0; ventasSnap.forEach(d => { totalV += d.data().total_cobrado || 0; });
      
      let totalG = 0; 
      let listaG = [];
      
      gastosSnap.forEach(docSnap => { 
        const d = docSnap.data();
        totalG += d.monto || 0; 
        listaG.push({ id: docSnap.id, ...d });
      });

      // 🟢 2. Ordenamos los gastos del más nuevo al más viejo localmente
      listaG.sort((a, b) => b.fecha.seconds - a.fecha.seconds);

      setAdmin(prev => ({ 
        ...prev, 
        gastos: listaG, 
        reporte: { totales: { totalVentas: totalV, totalGastos: totalG, balance: totalV - totalG } } 
      }));
    } catch (e) { 
      console.log("Error cargando reporte remoto", e); 
    }
  };

  const eliminarGastoAdmin = (idGasto) => {
    // 🟢 Soporte para pruebas en Navegador Web
    if (Platform.OS === 'web') {
      if (window.confirm('¿Eliminar este registro permanentemente?')) {
        deleteDoc(doc(db, 'gastos', idGasto)).then(() => {
          Alert.alert('Éxito', 'Gasto eliminado.');
          cargarReporteDueño();
        }).catch(() => {});
      }
      return;
    }
    
    // 🟢 Soporte para Celulares Nativos (Android/iOS)
    Alert.alert('Anular Gasto', '¿Eliminar este registro permanentemente?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'ELIMINAR', style: 'destructive', onPress: async () => {
        try {
          await deleteDoc(doc(db, 'gastos', idGasto));
          Alert.alert('Éxito', 'Gasto eliminado.');
          cargarReporteDueño(); 
        } catch (e) {}
      }}
    ]);
  };

  const guardarGastoAdmin = async () => {
    if (!admin.gastoData.descripcion || !admin.gastoData.monto) return Alert.alert('Aviso', 'Ingresa un concepto y un monto.');
    try {
      const qUltimo = query(collection(db, 'gastos'), orderBy('fecha', 'desc'), limit(1));
      const snapUltimo = await getDocs(qUltimo);
      let nextIdNum = 1;
      
      // 🟢 Extracción segura del número para el nuevo formato
      if (!snapUltimo.empty) {
         const lastDocId = snapUltimo.docs[0].id;
         if (lastDocId.startsWith('GAS-')) {
             nextIdNum = parseInt(lastDocId.replace('GAS-', '').split('-')[0], 10) + 1;
         }
      }
      
      // 🟢 NUEVO FORMATO DE ID: GAS-00000-AAAAMMDD
      const fechaLimpia = obtenerFechaActualLocal().replace(/-/g, '');
      const idFirestore = `GAS-${String(nextIdNum).padStart(5, '0')}-${fechaLimpia}`;
      
      await setDoc(doc(db, 'gastos', idFirestore), {
         categoria: admin.gastoData.categoria || 'Otros',
         concepto: admin.gastoData.descripcion,
         monto: parseFloat(admin.gastoData.monto),
         fecha: Timestamp.fromDate(new Date())
      });
      
      setAdmin(prev => ({ ...prev, gastoData: { descripcion: '', monto: '', categoria: 'Insumos' }, modalGasto: false }));
      Alert.alert('Éxito', `Gasto registrado en la Nube ☁️`);
      cargarReporteDueño(); 
    } catch (e) { Alert.alert('Error', `No se pudo registrar: ${e.message}`); }
  };

  const onRefreshAdmin = async () => {
    setAdmin(prev => ({ ...prev, refreshing: true }));
    await cargarReporteDueño();
    setAdmin(prev => ({ ...prev, refreshing: false }));
  };

  const toggleEstadoLocal = async () => {
    const hoy = obtenerFechaActualLocal();
    const estaCerrado = appData.estadoRestaurante.cierreForzado === hoy;
    const nuevoEstado = { ...appData.estadoRestaurante, cierreForzado: estaCerrado ? '' : hoy };
    try {
      await setDoc(doc(db, 'contenido', 'configuracion'), nuevoEstado, { merge: true });
      setAppData(prev => ({ ...prev, estadoRestaurante: nuevoEstado }));
      Alert.alert('Éxito', estaCerrado ? 'Restaurante ABIERTO' : 'Restaurante CERRADO');
    } catch(e) { Alert.alert('Error', 'No se pudo cambiar el estado en la nube'); }
  };

  const abrirEditorMenu = async () => {
    try {
      const snap = await getDoc(doc(db, 'contenido', 'menuDiario'));
      if (snap.exists()) setAdmin(prev => ({ ...prev, menuData: snap.data() }));
      setAdmin(prev => ({ ...prev, modalMenu: true }));
    } catch (e) { Alert.alert('Error', 'No se pudo cargar el menú desde la nube'); }
  };

  const guardarAdminMenu = async () => {
    try {
      const dataLimpia = JSON.parse(JSON.stringify(admin.menuData));
      await setDoc(doc(db, 'contenido', 'menuDiario'), dataLimpia);
      setAppData(prev => ({ ...prev, modoDomingo: admin.menuData.modoDomingo }));
      setAdmin(prev => ({ ...prev, modalMenu: false }));
      Alert.alert('Éxito', 'Menú actualizado en la Nube ☁️');
    } catch (e) { Alert.alert('Error', `Detalle técnico: ${e.message}`); }
  };

  const updateAdminMenu = (updates) => setAdmin(prev => ({ ...prev, menuData: { ...prev.menuData, ...updates } }));
  const toggleDomingoAdmin = () => {
    setAdmin(p => {
      const nuevoEstado = !p.menuData.modoDomingo;
      
      // 🟢 BARRIDO AUTOMÁTICO: Actualiza los segundos existentes al cambiar el modo
      const segundosActualizados = (p.menuData.segundos || []).map(s => ({
          ...s,
          precio: nuevoEstado ? "30" : "15",
          taper: nuevoEstado ? ['grande'] : ['mediano']
      }));

      return {
        ...p,
        menuData: {
          ...p.menuData,
          modoDomingo: nuevoEstado,
          titulo: nuevoEstado ? 'ESPECIALES DE DOMINGO 🍽️' : 'MENU DEL DIA 🍽️',
          segundos: segundosActualizados
        }
      };
    });
  };
  const updateMenuArr = (tipo, idx, campo, valor) => {
    const arr = [...(admin.menuData[tipo]||[])]; arr[idx][campo] = valor; updateAdminMenu({ [tipo]: arr });
  };
  const toggleTaperMenu = (type, idx, taperName) => {
     setAdmin(p => {
        const arr = [...p.menuData[type]];
        const row = { ...arr[idx] }; 
        let tapersActuales = Array.isArray(row.taper) ? [...row.taper] : (row.taper ? [row.taper] : []);
        
        if (tapersActuales.includes(taperName)) {
            tapersActuales = tapersActuales.filter(t => t !== taperName);
        } else {
            tapersActuales.push(taperName);
        }
        row.taper = tapersActuales;
        arr[idx] = row;
        return { ...p, menuData: { ...p.menuData, [type]: arr } };
     });
  };

  const addMenuRow = (tipo) => setAdmin(p => {
    let precioDefecto = tipo === 'entradas' ? 6 : 15;
    let tapersDefecto = tipo === 'entradas' ? ['sopa'] : ['mediano'];
    
    if (tipo === 'segundos' && p.menuData.modoDomingo) {
        precioDefecto = 30;
        tapersDefecto = ['grande'];
    }
    
    const nuevaFila = tipo === 'entradas' 
        ? { id: generarId(), nombre: '', precio: String(precioDefecto), taper: tapersDefecto, stock: '' } 
        : { id: generarId(), nombre: '', acomp: '', precio: String(precioDefecto), taper: tapersDefecto, stock: '' };
        
    return { ...p, menuData: { ...p.menuData, [tipo]: [...(p.menuData[tipo]||[]), nuevaFila] } };
  });

  const delMenuRow = (tipo, idx) => { const arr = [...admin.menuData[tipo]]; arr.splice(idx, 1); updateAdminMenu({ [tipo]: arr }); };

  const ciclarTaper = (tipo, idx) => {
     const opciones = ['', 'chico', 'sopa', 'mediano', 'grande'];
     const item = admin.menuData[tipo][idx];
     const nextTaper = opciones[(opciones.indexOf(item.taper || '') + 1) % opciones.length];
     updateMenuArr(tipo, idx, 'taper', nextTaper);
  };
  
  const aplicarGuarnicionGlobal = () => {
    if (!admin.guarnicionGlobal.trim()) return Alert.alert('Aviso', 'Escribe una guarnición primero.');
    const nuevosSegundos = (admin.menuData.segundos || []).map(s => ({ ...s, acomp: admin.guarnicionGlobal }));
    updateAdminMenu({ segundos: nuevosSegundos });
    setAdmin(prev => ({ ...prev, guarnicionGlobal: '' }));
  };

  // ─── FUNCIONES DEL MOZO ───
  const abrirMesa = (mesa) => {
    setMozo(prev => ({ ...prev, mesaActiva: mesa, filtroCarta: '', vistaActual: 'comandar' }));
    setCarrito([]);
  };

  const agregarAlCarrito = (plato, catNombre) => {
    // 1. Contamos cuántos de este plato ya metió el mozo al carrito
    const cantEnCarrito = carrito.filter(i => i.nombre === plato.nombre).reduce((acc, curr) => acc + curr.cantidad, 0);
    
    // 🟢 NUEVO: Candado de Stock
    if (plato.stock_actual !== null && plato.stock_actual !== undefined && cantEnCarrito >= plato.stock_actual) {
        return Alert.alert('Stock Agotado', `Solo quedan ${plato.stock_actual} raciones de ${plato.nombre}.`);
    }

    const index = carrito.findIndex(i => i.nombre === plato.nombre && i.modalidad === 'local' && i.nota === '');
    if (index > -1) { modificarCantidad(index, 1); }
    else {
      setCarrito(prev => [...prev, {
        id: generarId(), nombre: plato.nombre, precio: plato.precio,
        cantidad: 1, categoria: catNombre, modalidad: 'local', nota: '', cliente: null,
        stock_actual: plato.stock_actual !== undefined ? plato.stock_actual : null, 
        taper: plato.taper || '', 
        costo_taper: plato.costo_taper || 0 // 🟢 Taper Automático de Receta
      }]);
    }
  };

  const modificarCantidad = (index, cambio) => {
    setCarrito(prev => {
      const n = [...prev];
      const item = n[index];

      // 🟢 NUEVO: Bloqueo de seguridad dentro del carrito
      if (cambio > 0 && item.stock_actual !== null) {
         // Verificamos la suma total de ese plato en el carrito actual
         const cantTotalEnCarrito = n.filter(i => i.nombre === item.nombre).reduce((acc, curr) => acc + curr.cantidad, 0);
         if (cantTotalEnCarrito >= item.stock_actual) {
            Alert.alert('Stock Agotado', `Límite alcanzado. Solo quedan ${item.stock_actual} raciones.`);
            return prev; // Cancela el aumento y mantiene el carrito intacto
         }
      }

      n[index] = { ...item, cantidad: item.cantidad + cambio };
      if (n[index].cantidad <= 0) n.splice(index, 1);
      return n;
    });
  };

  // 🟢 NUEVO: Cerebro matemático para reflejar el precio con taper al instante en la App
  const calcularRecargoTaperMozo = (item) => {
      if (!item.modalidad || item.modalidad === 'local') return 0; 
      const cat = item.categoria ? item.categoria.toUpperCase().trim() : ''; 
      const nom = item.nombre ? item.nombre.toUpperCase().trim() : '';
      
      if (['JUGOS NATURALES', 'BEBIDAS HELADAS', 'BEBIDAS CALIENTES', 'CERVEZA', 'BEBIDAS'].includes(cat) || nom.includes('REFRESCO')) return 1; 

      let recargoEnvase = item.costo_taper || 0;
      if (!item.costo_taper && item.taper) {
          const tArr = Array.isArray(item.taper) ? item.taper : [item.taper];
          tArr.forEach(t => {
              if (t === 'chico' || t === 'sopa') recargoEnvase += 1;
              if (t === 'mediano' || t === 'grande') recargoEnvase += 2;
          });
      } else if (!item.costo_taper && (!item.taper || item.taper.length === 0)) {
          if (nom.includes('(ENTRADA)') || nom.includes('HUMITA') || nom.includes('ARROZ') || nom.includes('CAMOTE') || nom.includes('YUCA')) recargoEnvase += 1;
      }
      
      let recargoZona = 0;
      if (item.modalidad === 'delivery') recargoZona = 1;
      if (item.modalidad === 'delivery_centro') recargoZona = 3;
      
      return recargoEnvase + recargoZona; 
  };

  const ciclarModalidad = (index) => {
    // 🟢 NUEVO: Bloqueo de tapers manuales
    if (carrito[index].nombre.toUpperCase().startsWith('TAPER ')) return;
    const orden = ['local', 'llevar', 'delivery', 'delivery_centro'];
    const modActual = carrito[index].modalidad;
    const nextMod = orden[(orden.indexOf(modActual) + 1) % orden.length];

    if (carrito[index].cantidad > 1) {
       setUiSplit({ visible: true, idx: index, nextMod, cantidadTotal: carrito[index].cantidad, cantidadMover: 1 });
       return;
    }

    if ((nextMod === 'delivery' || nextMod === 'delivery_centro') && (modActual !== 'delivery' && modActual !== 'delivery_centro')) {
      setUi(prev => ({ ...prev, datosDelivery: { nombre: carrito[index].cliente?.nombre || '', direccion: carrito[index].cliente?.direccion || '', telefono: carrito[index].cliente?.telefono || '', idx: index, mod: nextMod }, modalDelivery: true }));
    } else {
      setCarrito(prev => {
        const n = [...prev];
        const clienteActual = n[index].cliente;
        n[index] = { ...n[index], modalidad: nextMod, cliente: (nextMod === 'delivery' || nextMod === 'delivery_centro') ? clienteActual : null };
        return n;
      });
    }
  };

  const confirmarSplit = () => {
    const { idx, nextMod, cantidadTotal, cantidadMover } = uiSplit;
    const modActual = carrito[idx].modalidad;
    let targetIdx = idx;
    let needDeliveryModal = false;

    setCarrito(prev => {
      let n = [...prev];
      const itemOriginal = { ...n[idx] };
      const matchIdx = n.findIndex((it, i) => i !== idx && it.nombre === itemOriginal.nombre && it.modalidad === nextMod && it.nota === itemOriginal.nota);

      if (cantidadMover === cantidadTotal) {
        if (matchIdx > -1) {
          n[matchIdx].cantidad += cantidadMover;
          targetIdx = matchIdx;
          n.splice(idx, 1);
        } else {
          n[idx].modalidad = nextMod;
          if (nextMod !== 'delivery' && nextMod !== 'delivery_centro') n[idx].cliente = null;
        }
      } else {
        n[idx].cantidad -= cantidadMover;
        if (matchIdx > -1) {
          n[matchIdx].cantidad += cantidadMover;
          targetIdx = matchIdx;
        } else {
          const newItem = { ...itemOriginal, id: generarId(), cantidad: cantidadMover, modalidad: nextMod };
          if (nextMod !== 'delivery' && nextMod !== 'delivery_centro') newItem.cliente = null;
          n.splice(idx + 1, 0, newItem);
          targetIdx = idx + 1;
        }
      }

      if ((nextMod === 'delivery' || nextMod === 'delivery_centro') && (modActual !== 'delivery' && modActual !== 'delivery_centro')) {
          needDeliveryModal = true;
      }
      return n;
    });

    if (needDeliveryModal) {
        setTimeout(() => {
            setUi(u => ({ ...u, datosDelivery: { nombre: '', direccion: '', telefono: '', idx: targetIdx, mod: nextMod }, modalDelivery: true }));
        }, 50);
    }

    setUiSplit({ visible: false, idx: null, nextMod: '', cantidadTotal: 0, cantidadMover: 1 });
  };

  const confirmarDatosDelivery = () => {
    if (!ui.datosDelivery.nombre || !ui.datosDelivery.direccion) return Alert.alert('Faltan datos', 'El nombre y dirección son obligatorios.');
    setCarrito(prev => {
      const n = [...prev];
      n[ui.datosDelivery.idx] = { 
        ...n[ui.datosDelivery.idx], 
        modalidad: ui.datosDelivery.mod,
        cliente: { nombre: ui.datosDelivery.nombre, direccion: ui.datosDelivery.direccion, telefono: ui.datosDelivery.telefono }
      };
      return n;
    });
    setUi(prev => ({ ...prev, modalDelivery: false }));
  };

  const guardarPlatoFueraCarta = () => {
    const p = parseFloat(ui.fueraCartaItem.precio);
    if (!ui.fueraCartaItem.nombre || isNaN(p)) return Alert.alert('Error', 'Ingrese nombre y precio válido.');
    setCarrito(prev => [...prev, { 
      id: generarId(), nombre: `${ui.fueraCartaItem.nombre} (Extra)`, 
      precio: p, cantidad: 1, categoria: 'GENERAL', modalidad: 'local', nota: '' 
    }]);
    setUi(prev => ({ ...prev, fueraCartaItem: { id: '', nombre: '', precio: '' }, modalFueraCarta: false }));
  };

  const guardarNota = () => {
    if (ui.itemEditando !== null) {
      const idx = ui.itemEditando;
      const textoNota = ui.notaInput.toUpperCase().trim();
      const cantidadMover = ui.notaCantidadMover;
      
      setCarrito(prev => {
        let n = [...prev];
        const itemOriginal = n[idx];
        const cantidadTotal = itemOriginal.cantidad;

        if (cantidadMover === cantidadTotal) {
          // Se aplica a todo el grupo
          n[idx] = { ...itemOriginal, nota: textoNota };
        } else {
          // Se rompe el grupo: restamos cantidad al renglón base
          n[idx] = { ...itemOriginal, cantidad: cantidadTotal - cantidadMover };
          
          // Creamos una nueva entidad en el carrito con su propia ID y nota
          const newItem = { ...itemOriginal, id: generarId(), cantidad: cantidadMover, nota: textoNota };
          n.splice(idx + 1, 0, newItem);
        }

        // Auto-Merge en caliente: Si el mozo fracciona y le pone una nota idéntica a algo que ya existía, se fusionan
        let agrupado = [];
        n.forEach(it => {
          let idxMatch = agrupado.findIndex(f => f.nombre === it.nombre && f.modalidad === it.modalidad && (f.nota || '') === (it.nota || ''));
          if (idxMatch > -1) {
            agrupado[idxMatch].cantidad += it.cantidad;
          } else {
            agrupado.push(it);
          }
        });
        return agrupado;
      });
    }
    setUi(prev => ({ ...prev, modalNota: false }));
  };

  const enviarComanda = async () => {
    if (carrito.length === 0) return Alert.alert('Aviso', 'El carrito está vacío');
    try {
      await axios.post(`http://${sys.ipServidor}:3001/api/pedidos`, { mesa: mozo.mesaActiva.id, items: carrito });
      setMozo(prev => ({ ...prev, vistaActual: 'mesas' }));
      Alert.alert('✅ ¡Enviado!', 'La orden se ha impreso en cocina.');
    } catch { Alert.alert('Error', '❌ No se pudo enviar la comanda'); }
  };

  const formatMesaName = (id) => {
    if (!id) return '';
    const idStr = String(id).replace('.0', ''); 
    if (idStr.startsWith('DEL-')) return idStr;
    return `MESA ${idStr.replace('mesa_', '')}`;
  };

  const mesasOrdenadas = appData.mesas.slice().sort((a, b) => {
    const numA = parseInt(String(a.id).replace(/\D/g, ''));
    const numB = parseInt(String(b.id).replace(/\D/g, ''));
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a.id).localeCompare(String(b.id));
  });

  const totalItems = carrito.reduce((s, i) => s + i.cantidad, 0);
  const elRestauranteEstaCerrado = appData.estadoRestaurante.cierreForzado === obtenerFechaActualLocal();

  // ═══════════════════════════════════════════════════════════
  // SINGLE RETURN ARQUITECTURE (Solución a Rerender issues)
  // ═══════════════════════════════════════════════════════════
  return (
    <View style={s.safeAreaBlue}>
      <StatusBar style="light" />
      
      {/* ─── PANTALLA 1: CONFIGURAR IP ─── */}
      {sys.modoConfig && (
        <View style={s.cfgScreen}>
          <View style={s.cfgCard}>
            <View style={s.cfgLogoWrap}>
              <Text style={s.cfgLogo}>Calletano</Text>
              <Text style={s.cfgLogoSub}>SISTEMA POS · CONFIGURACIÓN</Text>
            </View>
            <View style={s.cfgDivider} />
            <Text style={s.cfgLabel}>Dirección IP de la Caja</Text>
            <TextInput style={s.cfgInput} placeholder="Ej: 192.168.1.50" placeholderTextColor={C.textMuted} value={sys.ipInput} onChangeText={t => setSys(prev => ({ ...prev, ipInput: t }))} keyboardType="numeric" returnKeyType="done" />
            <Touchable style={s.btnPrimary} onPress={guardarIP}><Text style={s.btnPrimaryText}>Guardar y Conectar</Text></Touchable>
            {sys.ipServidor !== '' && <Touchable style={s.btnSecondary} onPress={() => setSys(prev => ({ ...prev, modoConfig: false }))}><Text style={s.btnSecondaryText}>← Volver al sistema</Text></Touchable>}
          </View>
        </View>
      )}

      {/* ─── PANTALLA 2: LOGIN ─── */}
      {!sys.modoConfig && !authData.usuarioActivo && (
        <View style={s.cfgScreen}>
          <View style={s.cfgCard}>
            <View style={s.cfgLogoWrap}>
              <Text style={s.cfgLogo}>Calletano</Text>
              <Text style={s.cfgLogoSub}>SISTEMA DE CONTROL</Text>
            </View>
            {authData.error !== '' && <Text style={{color: C.danger, textAlign: 'center', marginBottom: 15, fontWeight: '800', fontSize: 13}}>{authData.error}</Text>}
            <TextInput style={[s.cfgInput, {textAlign: 'left'}]} placeholder="Usuario" placeholderTextColor={C.textMuted} value={authData.username} onChangeText={t => setAuthData(prev => ({ ...prev, username: t }))} autoCapitalize="none" />
            <TextInput style={[s.cfgInput, {textAlign: 'left', marginBottom: 25}]} placeholder="Contraseña" placeholderTextColor={C.textMuted} value={authData.password} onChangeText={t => setAuthData(prev => ({ ...prev, password: t }))} secureTextEntry />
            <Touchable style={s.btnPrimary} onPress={handleLogin}><Text style={s.btnPrimaryText}>Ingresar</Text></Touchable>
            <Touchable style={{marginTop: 30, alignItems: 'center'}} onPress={() => setSys(prev => ({ ...prev, modoConfig: true }))}><Text style={{color: C.textMuted, fontSize: 12, fontWeight: '800'}}>⚙️ Cambiar IP de Servidor</Text></Touchable>
          </View>
        </View>
      )}

      {/* ─── PANTALLA 3: APP DEL DUEÑO ─── */}
      {!sys.modoConfig && authData.usuarioActivo && authData.usuarioActivo.rol === 'admin' && (
        <>
          <View style={s.navbar}>
            <Text style={s.navBrand}>Dueño <Text style={{fontSize: 14, color: C.gold}}>POS</Text></Text>
            <View style={s.navRight}>
              <View style={[s.statusPill, sys.conectado ? s.statusPillOn : s.statusPillOff]}>
                <View style={[s.statusDot, { backgroundColor: sys.conectado ? C.success : C.danger }]} />
                <Text style={s.statusPillText} numberOfLines={1}>{sys.serverStatus}</Text>
              </View>
              <Touchable onPress={cerrarSesion} style={s.cfgIconBtn}><Feather name="log-out" size={20} color={C.surface} /></Touchable>
            </View>
          </View>

          <ScrollView style={s.scrollBase} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} contentInsetAdjustmentBehavior="automatic" refreshControl={<RefreshControl refreshing={admin.refreshing} onRefresh={onRefreshAdmin} tintColor={C.gold} />}>
            <Text style={s.seccionTitle}>ACCIONES ADMINISTRATIVAS</Text>
            <View style={{flexDirection: 'row', gap: 12, marginBottom: 24}}>
               <Touchable style={[s.quickBtn, {backgroundColor: C.surface, borderColor: C.gold}]} onPress={abrirEditorMenu}>
                  <Feather name="edit-3" size={24} color={C.gold} style={{marginBottom: 8}}/>
                  <Text style={{fontSize: 11, fontWeight: '800', color: C.textDark}}>EDITAR MENÚ</Text>
               </Touchable>
               <Touchable style={[s.quickBtn, {backgroundColor: C.surface, borderColor: C.danger}]} onPress={() => setAdmin(prev => ({ ...prev, modalGasto: true }))}>
                  <Feather name="dollar-sign" size={24} color={C.danger} style={{marginBottom: 8}}/>
                  <Text style={{fontSize: 11, fontWeight: '800', color: C.textDark}}>NUEVO GASTO</Text>
               </Touchable>
            </View>

            <Text style={s.seccionTitle}>ARQUEO EN VIVO (HOY)</Text>
            <View style={{backgroundColor: C.surface, borderRadius: 16, padding: 24, marginBottom: 24, borderWidth: 1, borderColor: C.border}}>
              <Text style={{fontSize: 12, fontWeight: '800', color: C.textMuted, letterSpacing: 1, marginBottom: 8}}>INGRESO BRUTO</Text>
              <Text style={{fontSize: 36, fontWeight: '800', color: C.success, marginBottom: 24}}>S/ {admin.reporte?.totales?.totalVentas?.toFixed(2) || '0.00'}</Text>
              <Text style={{fontSize: 12, fontWeight: '800', color: C.textMuted, letterSpacing: 1, marginBottom: 8}}>EGRESOS REGISTRADOS</Text>
              <Text style={{fontSize: 24, fontWeight: '800', color: C.danger, marginBottom: 24}}>S/ {admin.reporte?.totales?.totalGastos?.toFixed(2) || '0.00'}</Text>
              <View style={{height: 1, backgroundColor: C.border, marginVertical: 10, marginBottom: 20}} />
              <Text style={{fontSize: 12, fontWeight: '800', color: C.gold, letterSpacing: 1, marginBottom: 8}}>GANANCIA NETA OPERATIVA</Text>
              <Text style={{fontSize: 28, fontWeight: '800', color: C.primary}}>S/ {admin.reporte?.totales?.balance?.toFixed(2) || '0.00'}</Text>
            </View>

            <Text style={s.seccionTitle}>DETALLE DE GASTOS (HOY)</Text>
            <View style={{backgroundColor: C.surface, borderRadius: 16, padding: 12, marginBottom: 24, borderWidth: 1, borderColor: C.border}}>
              {admin.gastos.length === 0 ? (
                <Text style={{textAlign: 'center', color: C.textMuted, padding: 20, fontSize: 13}}>No hay gastos registrados hoy.</Text>
              ) : (
                admin.gastos.map((g, index) => (
                  <View key={g.id} style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: index === admin.gastos.length - 1 ? 0 : 1, borderBottomColor: C.border}}>
                    <View style={{flex: 1}}>
                      <Text style={{fontSize: 14, fontWeight: '700', color: C.textDark}}>{g.concepto}</Text>
                      <Text style={{fontSize: 11, color: C.textMuted, textTransform: 'uppercase'}}>{g.categoria}</Text>
                    </View>
                    <Text style={{fontSize: 15, fontWeight: '800', color: C.danger, marginRight: 15}}>S/ {g.monto.toFixed(2)}</Text>
                    <Touchable onPress={() => eliminarGastoAdmin(g.id)} style={{padding: 8}}>
                      <Feather name="trash-2" size={18} color={C.textMuted} />
                    </Touchable>
                  </View>
                ))
              )}
            </View>

            <Text style={s.seccionTitle}>CONTROL REMOTO</Text>
            <View style={{backgroundColor: C.surface, borderRadius: 16, padding: 24, borderWidth: 1, borderColor: C.border, alignItems: 'center'}}>
               <MaterialCommunityIcons name={elRestauranteEstaCerrado ? 'door-closed-lock' : 'door-open'} size={48} color={elRestauranteEstaCerrado ? C.danger : C.success} style={{marginBottom: 16}} />
               <Text style={{fontSize: 18, fontWeight: '800', color: C.textDark, marginBottom: 24}}>
                 El restaurante está {elRestauranteEstaCerrado ? 'CERRADO' : 'ABIERTO'}
               </Text>
               <Touchable style={[s.btnPrimary, {width: '100%', backgroundColor: elRestauranteEstaCerrado ? C.success : C.danger}]} onPress={toggleEstadoLocal}>
                 <Text style={s.btnPrimaryText}>{elRestauranteEstaCerrado ? 'ABRIR RESTAURANTE AHORA' : 'CERRAR POR HOY'}</Text>
               </Touchable>
            </View>
          </ScrollView>

          {/* Modal Gasto */}
          <Modal visible={admin.modalGasto} transparent animationType="fade">
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
              <View style={s.modalCard}>
                <Text style={s.modalTitle}>Registrar Gasto</Text>
                <Text style={s.modalSubtitle}>Se descontará del flujo neto de hoy</Text>
                <TextInput style={s.modalInputCompact} placeholder="Concepto (Ej. Verduras)" placeholderTextColor={C.textMuted} value={admin.gastoData.descripcion} onChangeText={t => setAdmin(prev => ({ ...prev, gastoData: { ...prev.gastoData, descripcion: t } }))} />
                <TextInput style={s.modalInputCompact} placeholder="Monto (S/)" placeholderTextColor={C.textMuted} value={admin.gastoData.monto} onChangeText={t => setAdmin(prev => ({ ...prev, gastoData: { ...prev.gastoData, monto: t } }))} keyboardType="decimal-pad" />
                <Text style={{fontSize: 12, fontWeight: '800', color: C.textMuted, marginBottom: 8, marginTop: 10}}>CATEGORÍA CONTABLE</Text>
                <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20}}>
                   {['Insumos', 'Personal', 'Servicios', 'Otros'].map(c => (
                     <Touchable key={c} onPress={() => setAdmin(prev => ({ ...prev, gastoData: { ...prev.gastoData, categoria: c } }))} 
                       style={{paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: admin.gastoData.categoria === c ? C.danger : C.border, borderRadius: 8, backgroundColor: admin.gastoData.categoria === c ? C.danger : C.surface}}>
                        <Text style={{color: admin.gastoData.categoria === c ? C.surface : C.textMuted, fontWeight: '700', fontSize: 13}}>{c}</Text>
                     </Touchable>
                   ))}
                </View>
                <Touchable style={[s.btnPrimary, {backgroundColor: C.danger}]} onPress={guardarGastoAdmin}><Text style={s.btnPrimaryText}>Guardar Gasto</Text></Touchable>
                <Touchable style={s.btnSecondary} onPress={() => setAdmin(prev => ({ ...prev, modalGasto: false }))}><Text style={s.btnSecondaryText}>Cancelar</Text></Touchable>
              </View>
            </KeyboardAvoidingView>
          </Modal>

          {/* Modal Editor Menú */}
          <Modal visible={admin.modalMenu} animationType="slide">
            <SafeAreaView style={{flex: 1, backgroundColor: C.bg}}>
              <View style={[s.navbar, {justifyContent: 'space-between'}]}>
                 <Touchable onPress={() => setAdmin(prev => ({ ...prev, modalMenu: false }))} style={{padding: 10}}><Feather name="x" size={26} color={C.surface} /></Touchable>
                 <Text style={[s.navTitle, {fontSize: 18}]}>Editor de Menú</Text>
                 <Touchable onPress={guardarAdminMenu} style={{padding: 10}}><Feather name="check" size={26} color={C.surface} /></Touchable>
              </View>
              <ScrollView contentContainerStyle={{padding: 16}} contentInsetAdjustmentBehavior="automatic">
                 <Text style={s.seccionTitle}>CONFIGURACIÓN GENERAL</Text>
                 <TextInput style={s.modalInputCompact} placeholder="Título a mostrar" value={admin.menuData.titulo} onChangeText={t => updateAdminMenu({titulo: t})} />
                 <Touchable style={[s.quickBtn, {backgroundColor: admin.menuData.modoDomingo ? C.dangerSoft : C.surface, borderColor: admin.menuData.modoDomingo ? C.danger : C.border, marginBottom: 20}]} onPress={toggleDomingoAdmin}>
                    <Text style={{fontWeight: '800', color: admin.menuData.modoDomingo ? C.danger : C.textDark}}>{admin.menuData.modoDomingo ? 'ACTIVADO: MODO DOMINGO' : 'DESACTIVADO: DÍA NORMAL'}</Text>
                 </Touchable>

                 {!admin.menuData.modoDomingo && (
                   <View style={{backgroundColor: C.surface, padding: 12, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: C.border}}>
                      <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16}}>
                         <Text style={{fontWeight: '800', color: C.gold, fontSize: 16}}>ENTRADAS</Text>
                         <Touchable onPress={() => addMenuRow('entradas')}><Text style={{color: C.gold, fontWeight: '800', fontSize: 14}}>+ Añadir</Text></Touchable>
                      </View>
                      {(admin.menuData.entradas||[]).map((e, idx) => (
                        <View key={e.id || `ent-${idx}`} style={{backgroundColor: C.surface, padding: 12, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: C.border}}>
                           <View style={{flexDirection: 'row', gap: 8}}>
                             <TextInput style={[s.modalInputCompact, {flex: 1, marginBottom: 0, paddingVertical: 10}]} placeholder="Nombre de Entrada" value={e.nombre} onChangeText={t => updateMenuArr('entradas', idx, 'nombre', t)} />
                             <View style={{alignItems: 'center'}}>
                               <Text style={{fontSize: 9, color: C.primary, fontWeight: 'bold', marginBottom: 2}}>PRECIO S/</Text>
                               <TextInput style={[s.modalInputCompact, {width: 60, marginBottom: 0, paddingVertical: 10, textAlign: 'center'}]} placeholder="S/" value={String(e.precio)} onChangeText={t => updateMenuArr('entradas', idx, 'precio', t)} keyboardType="decimal-pad" />
                             </View>
                             <View style={{alignItems: 'center'}}>
                               <Text style={{fontSize: 9, color: '#006989', fontWeight: 'bold', marginBottom: 2}}>📦 STOCK</Text>
                               <TextInput style={[s.modalInputCompact, {width: 60, marginBottom: 0, paddingVertical: 10, textAlign: 'center', borderColor: '#006989', color: '#006989'}]} placeholder="Stock" value={String(e.stock || '')} onChangeText={t => updateMenuArr('entradas', idx, 'stock', t)} keyboardType="number-pad" />
                             </View>
                             <Touchable onPress={() => delMenuRow('entradas', idx)} style={{justifyContent: 'center', paddingHorizontal: 4}}><Feather name="trash-2" size={22} color={C.danger}/></Touchable>
                           </View>
                           
                           <Text style={{fontSize: 10, fontWeight: '800', color: C.textMuted, marginTop: 8, marginBottom: 4}}>ENVASES (LLEVAR/DELIVERY)</Text>
                           <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
                             {['chico', 'sopa', 'mediano', 'grande'].map(t => {
                                const tapersAct = Array.isArray(e.taper) ? e.taper : (e.taper ? [e.taper] : []);
                                const activo = tapersAct.includes(t);
                                return (
                                   <Touchable key={t} onPress={() => toggleTaperMenu('entradas', idx, t)} style={{backgroundColor: activo ? C.gold : C.bg, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: activo ? C.gold : C.border}}>
                                      <Text style={{fontSize: 10, fontWeight: 'bold', color: activo ? C.primary : C.textMuted}}>{t.toUpperCase()}</Text>
                                   </Touchable>
                                );
                             })}
                           </View>
                        </View>
                      ))}
                   </View>
                 )}

                 <View style={{backgroundColor: C.surface, padding: 12, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: C.border}}>
                    <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16}}>
                       <Text style={{fontWeight: '800', color: C.danger, fontSize: 16}}>SEGUNDOS</Text>
                       <Touchable onPress={() => addMenuRow('segundos')}><Text style={{color: C.danger, fontWeight: '800', fontSize: 14}}>+ Añadir</Text></Touchable>
                    </View>
                    <View style={{flexDirection: 'row', gap: 8, marginBottom: 16, backgroundColor: C.dangerSoft, padding: 8, borderRadius: 8, alignItems: 'center'}}>
                       <TextInput style={[s.modalInputCompact, {flex: 1, marginBottom: 0, paddingVertical: 6, backgroundColor: C.surface}]} placeholder="Guarnición general" value={admin.guarnicionGlobal} onChangeText={t => setAdmin(prev => ({ ...prev, guarnicionGlobal: t }))} />
                       <Touchable style={{backgroundColor: C.danger, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, justifyContent: 'center'}} onPress={aplicarGuarnicionGlobal}><Text style={{color: C.surface, fontWeight: '800', fontSize: 11}}>APLICAR A TODOS</Text></Touchable>
                    </View>
                    {(admin.menuData.segundos||[]).map((sItem, idx) => (
                      <View key={sItem.id || `seg-${idx}`} style={{backgroundColor: C.bg, padding: 12, borderRadius: 8, marginBottom: 12}}>
                          <View style={{flexDirection: 'row', gap: 8}}>
                            <View style={{flex: 1, gap: 8}}>
                              <TextInput style={[s.modalInputCompact, {marginBottom: 0, paddingVertical: 10}]} placeholder="Nombre de Fondo" value={sItem.nombre} onChangeText={t => updateMenuArr('segundos', idx, 'nombre', t)} />
                              <TextInput style={[s.modalInputCompact, {marginBottom: 0, fontSize: 13, paddingVertical: 8}]} placeholder="Acompañamiento (Opcional)" value={sItem.acomp||''} onChangeText={t => updateMenuArr('segundos', idx, 'acomp', t)} />
                            </View>
                            <View style={{justifyContent: 'space-between', alignItems: 'center', gap: 8}}>
                              <View style={{alignItems: 'center'}}>
                                <Text style={{fontSize: 9, color: C.danger, fontWeight: 'bold', marginBottom: 2}}>PRECIO S/</Text>
                                <TextInput style={[s.modalInputCompact, {width: 75, marginBottom: 0, textAlign: 'center', color: C.danger, fontWeight: '800'}]} placeholder="S/" value={String(sItem.precio)} onChangeText={t => updateMenuArr('segundos', idx, 'precio', t)} keyboardType="decimal-pad" />
                              </View>
                              <View style={{alignItems: 'center'}}>
                                <Text style={{fontSize: 9, color: '#006989', fontWeight: 'bold', marginBottom: 2}}>📦 STOCK</Text>
                                <TextInput style={[s.modalInputCompact, {width: 75, marginBottom: 0, textAlign: 'center', borderColor: '#006989', color: '#006989', fontWeight: '800'}]} placeholder="Stock" value={String(sItem.stock || '')} onChangeText={t => updateMenuArr('segundos', idx, 'stock', t)} keyboardType="number-pad" />
                              </View>
                              <Touchable onPress={() => delMenuRow('segundos', idx)} style={{padding: 8}}><Feather name="trash-2" size={22} color={C.danger}/></Touchable>
                            </View>
                          </View>
                          
                          <Text style={{fontSize: 10, fontWeight: '800', color: C.textMuted, marginTop: 8, marginBottom: 4}}>ENVASES (LLEVAR/DELIVERY)</Text>
                           <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
                             {['chico', 'sopa', 'mediano', 'grande'].map(t => {
                                const tapersAct = Array.isArray(sItem.taper) ? sItem.taper : (sItem.taper ? [sItem.taper] : []);
                                const activo = tapersAct.includes(t);
                                return (
                                   <Touchable key={t} onPress={() => toggleTaperMenu('segundos', idx, t)} style={{backgroundColor: activo ? C.danger : C.surface, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: activo ? C.danger : C.border}}>
                                      <Text style={{fontSize: 10, fontWeight: 'bold', color: activo ? C.surface : C.textMuted}}>{t.toUpperCase()}</Text>
                                   </Touchable>
                                );
                             })}
                           </View>
                      </View>
                    ))}
                 </View>

                 <Text style={s.seccionTitle}>BEBIDA INCLUIDA</Text>
                 <TextInput style={[s.modalInputCompact, {minHeight: 80}]} placeholder="Ej: Chicha Morada..." value={admin.menuData.refresco} onChangeText={t => updateAdminMenu({refresco: t})} multiline />
                 <Touchable style={[s.btnPrimary, {marginTop: 20, marginBottom: 40}]} onPress={guardarAdminMenu}><Text style={s.btnPrimaryText}>Publicar Menú en Caja</Text></Touchable>
              </ScrollView>
            </SafeAreaView>
          </Modal>
        </>
      )}

      {/* ─── PANTALLA 4: COMANDERA TÁCTIL ─── */}
      {!sys.modoConfig && authData.usuarioActivo && authData.usuarioActivo.rol !== 'admin' && mozo.vistaActual === 'comandar' && mozo.mesaActiva && (
        <>
          <View style={s.navbar}>
            <Touchable style={s.navBackBtn} onPress={() => setMozo(prev => ({ ...prev, vistaActual: 'mesas' }))} hitSlop={{ top: 25, bottom: 25, left: 25, right: 25 }}>
              <Feather name="chevron-left" size={28} color={C.surface} />
              <Text style={s.navBackText}>Mesas</Text>
            </Touchable>
            <Text style={s.navTitle} numberOfLines={1}>{mozo.mesaActiva ? formatMesaName(mozo.mesaActiva.id) : ''}</Text>
            <View style={{ width: 80 }} />
          </View>

          <ScrollView style={s.scrollBase} contentContainerStyle={{ padding: 12, paddingBottom: carrito.length > 0 ? 320 : 40 }} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
            <View style={s.searchWrap}>
              <Feather name="search" size={20} color={C.textMuted} style={s.searchIcon} />
              <TextInput style={s.searchInput} placeholder="Buscar plato..." placeholderTextColor={C.textMuted} value={mozo.filtroCarta} onChangeText={t => setMozo(prev => ({ ...prev, filtroCarta: t }))} />
              {mozo.filtroCarta.length > 0 && <Touchable onPress={() => setMozo(prev => ({ ...prev, filtroCarta: '' }))} style={s.searchClear}><Feather name="x-circle" size={20} color={C.textMuted} /></Touchable>}
            </View>

            {mozo.filtroCarta === '' && (
              <>
                <View style={s.quickGrid}>
                  <Touchable style={[s.quickBtn, s.quickBtnBlue]} onPress={() => agregarAlCarrito({ nombre: 'TAPER CHICO', precio: 1.0 }, 'GENERAL')}>
                    <MaterialCommunityIcons name="cube-outline" size={28} color={C.primary} style={{marginBottom: 4}} />
                    <Text style={s.quickBtnLabel}>T. Chico</Text>
                    <Text style={s.quickBtnPrice}>S/ 1.00</Text>
                  </Touchable>
                  <Touchable style={[s.quickBtn, s.quickBtnRed]} onPress={() => agregarAlCarrito({ nombre: 'TAPER MEDIANO', precio: 2.0 }, 'GENERAL')}>
                    <MaterialCommunityIcons name="cube" size={28} color={C.danger} style={{marginBottom: 4}} />
                    <Text style={[s.quickBtnLabel, {color: C.danger}]}>T. Mediano</Text>
                    <Text style={[s.quickBtnPrice, {color: C.danger}]}>S/ 2.00</Text>
                  </Touchable>
                </View>
                <View style={[s.quickGrid, {marginBottom: 16}]}>
                  <Touchable style={[s.quickBtn, {backgroundColor: C.surface}]} onPress={() => agregarAlCarrito({ nombre: 'HUMITA', precio: 3.0 }, 'ENTRADAS')}>
                    <MaterialCommunityIcons name="corn" size={28} color={C.gold} style={{marginBottom: 4}} />
                    <Text style={[s.quickBtnLabel, {color: C.gold}]}>Humita</Text>
                    <Text style={s.quickBtnPrice}>S/ 3.00</Text>
                  </Touchable>
                  <Touchable style={[s.quickBtn, {backgroundColor: C.surface}]} onPress={() => agregarAlCarrito({ nombre: 'REFRESCO', precio: appData.modoDomingo ? 3.5 : 2.0 }, 'BEBIDAS')}>
                    <MaterialCommunityIcons name="glass-cocktail" size={28} color={C.primary} style={{marginBottom: 4}} />
                    <Text style={[s.quickBtnLabel, {color: C.primary}]}>Refresco</Text>
                    <Text style={s.quickBtnPrice}>S/ {appData.modoDomingo ? '3.50' : '2.00'}</Text>
                  </Touchable>
                </View>
                <Touchable style={s.fueraCarta} onPress={() => setUi(prev => ({ ...prev, modalFueraCarta: true }))}>
                  <Feather name="edit-3" size={18} color={C.textMuted} /><Text style={s.fueraCartaText}>Plato fuera de carta</Text>
                </Touchable>
              </>
            )}

            {mozo.mesaActiva.pedido?.length > 0 && mozo.filtroCarta === '' && (
              <View style={s.yaPedidoCard}>
                <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 8}}>
                  <Feather name="list" size={16} color={C.primary} /><Text style={s.yaPedidoTitle}>Ya en esta mesa</Text>
                </View>
                {mozo.mesaActiva.pedido.map((p, i) => (
                  <View key={p.id || `pedido-${i}`} style={s.yaPedidoRow}>
                    <Text style={s.yaPedidoItem}>
                      <Text style={{ color: C.danger, fontWeight: '700' }}>{p.cantidad}×  </Text>
                      <Text style={{ color: C.textDark, fontWeight: '600' }}>{p.nombre}</Text>
                      {p.modalidad !== 'local' && <Text style={{ color: C.textMuted }}> · {p.modalidad}</Text>}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {appData.carta.filter(c => ['entradas', 'segundos'].includes(c.nombre.toLowerCase().trim())).map((cat) => {
              if (appData.modoDomingo && cat.nombre.toLowerCase().trim() === 'entradas') return null;
              const items = cat.items.filter(p => p.nombre.toLowerCase().includes(mozo.filtroCarta.toLowerCase()));
              if (items.length === 0) return null;
              const esEntrada = cat.nombre === 'entradas';
              return (
                <View key={cat.nombre} style={{ marginBottom: 10 }}>
                  <Text style={s.catLabel}>{cat.nombre}</Text>
                  <View style={s.platosGrid}>
                    {items.map(plato => {
                      const cantEnCarrito = carrito.filter(i => i.nombre === plato.nombre).reduce((acc, curr) => acc + curr.cantidad, 0);
                      
                      // 🟢 NUEVAS BANDERAS DE INVENTARIO
                      const agotado = plato.stock_actual !== null && plato.stock_actual <= 0;
                      const pocoStock = plato.stock_actual !== null && plato.stock_actual <= 3 && plato.stock_actual > 0;

                      return (
                        <Touchable 
                           key={plato.id || plato.nombre} 
                           style={[s.platoBtn, agotado && { opacity: 0.4, backgroundColor: C.border }]} 
                           disabled={agotado}
                           onPress={() => agregarAlCarrito(plato, cat.nombre)}
                        >
                          <View style={[s.platoBtnBar, { backgroundColor: agotado ? C.textMuted : (esEntrada ? C.primary : C.danger) }]} />
                          
                          {/* Globo rojo vibrante para stock crítico */}
                          {pocoStock && (
                            <View style={[s.badgeComanda, { backgroundColor: C.danger }]}>
                              <Text style={s.badgeComandaText}>¡Solo quedan {plato.stock_actual}!</Text>
                            </View>
                          )}

                          {/* Badge de "Ya en carrito" (el que hicimos antes) */}
                          {cantEnCarrito > 0 && !pocoStock && (
                            <View style={s.badgeComanda}>
                              <Text style={s.badgeComandaText}>{cantEnCarrito} pedidos</Text>
                            </View>
                          )}

                          <Text style={[s.platoNombre, agotado && { textDecorationLine: 'line-through', color: C.textMuted }]} numberOfLines={2}>{plato.nombre}</Text>
                          <Text style={[s.platoPrecio, { color: agotado ? C.textMuted : (esEntrada ? C.primary : C.danger) }]}>
                            {agotado ? 'AGOTADO' : `S/ ${plato.precio.toFixed(2)}`}
                          </Text>
                        </Touchable>
                      );
                    })}
                  </View>
                </View>
              );
            })}

            {appData.carta.filter(c => c.nombre !== 'entradas' && c.nombre !== 'segundos').map((cat) => {
              const items = cat.items.filter(p => p.nombre.toLowerCase().includes(mozo.filtroCarta.toLowerCase()));
              if (items.length === 0) return null;
              return (
                <View key={cat.nombre} style={s.seccionWrap}>
                  <Text style={s.seccionTitle}><Feather name="book-open" size={18} color={C.textMuted}/> {cat.nombre}</Text>
                  <View style={s.platosGrid}>
                    {items.map(plato => {
                      // 🟢 Calculamos si este plato ya está en el carrito actual
                      const cantEnCarrito = carrito.filter(i => i.nombre === plato.nombre).reduce((acc, curr) => acc + curr.cantidad, 0);
                      
                      return (
                        <Touchable key={plato.id || plato.nombre} style={s.platoBtn} onPress={() => agregarAlCarrito(plato, cat.nombre)}>
                          <View style={[s.platoBtnBar, { backgroundColor: cat.nombre === 'entradas' ? C.primary : (cat.nombre === 'segundos' ? C.danger : C.textDark) }]} />
                          
                          {/* 🟢 Badge visual de advertencia */}
                          {cantEnCarrito > 0 && (
                            <View style={s.badgeComanda}>
                              <Text style={s.badgeComandaText}>{cantEnCarrito} pedidos</Text>
                            </View>
                          )}

                          <Text style={s.platoNombre} numberOfLines={2}>{plato.nombre}</Text>
                          <Text style={[s.platoPrecio, { color: cat.nombre === 'entradas' ? C.primary : (cat.nombre === 'segundos' ? C.danger : C.textDark) }]}>S/ {plato.precio.toFixed(2)}</Text>
                        </Touchable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* ─── BURBUJA FLOTANTE (FAB) ─── */}
          {carrito.length > 0 && (
            <Touchable style={s.fabBtn} onPress={() => setCartVisible(true)}>
              <Feather name="shopping-bag" size={26} color={C.surface} />
              <View style={s.fabBadge}><Text style={s.fabBadgeText}>{totalItems}</Text></View>
            </Touchable>
          )}

          {/* ─── TELÓN DE LA COMANDA (SWIPE-TO-CLOSE) ─── */}
          <Modal visible={cartVisible} animationType="slide" transparent={true} onRequestClose={() => setCartVisible(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
              <View style={{ height: '90%', backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' }}>

                {/* 🟢 CABECERA TÁCTIL: JALA ESTO PARA CERRAR */}
                <View {...panResponder.panHandlers} style={{ backgroundColor: C.surface, alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: C.border }}>
                  <View style={{ width: 50, height: 5, backgroundColor: C.borderFocus, borderRadius: 10, marginBottom: 12 }} />
                  <Text style={s.carritoHeaderTitle}>Por Enviar a Cocina ({totalItems})</Text>
                </View>

                <ScrollView style={{ paddingHorizontal: 16, flex: 1 }} contentInsetAdjustmentBehavior="automatic">
                  {carrito.map((item, idx) => {
                    const esLocal = item.modalidad === 'local';
                    return (
                      <View key={item.id} style={s.carritoItem}>
                        <View style={s.carritoItemRow1}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.carritoItemNombre} numberOfLines={2}><Text style={{ color: C.primary, fontWeight: '800' }}>{item.cantidad}×  </Text>{item.nombre}</Text>
                            {/* 🟢 MOSTRAR TAPER EN CARRITO */}
                            {item.modalidad !== 'local' && item.taper && <Text style={{fontSize: 11, color: C.textMuted, marginTop: 2, fontWeight: 'bold'}}>+ Envase {Array.isArray(item.taper) ? item.taper.join(' y ') : item.taper}</Text>}
                            {item.cliente && <Text style={s.carritoItemNota}><Feather name="map-pin" size={12}/> Delivery a: {item.cliente.nombre}</Text>}
                            {item.nota ? <Text style={s.carritoItemNota}><Feather name="alert-circle" size={12}/> {item.nota}</Text> : null}
                          </View>
                          {/* 🟢 NUEVO: Muestra el subtotal real con tapers al instante */}
                          <Text style={s.carritoItemPrecio}>S/ {((item.precio + calcularRecargoTaperMozo(item)) * item.cantidad).toFixed(2)}</Text>
                        </View>
                        <View style={s.carritoItemRow2}>
                          <Touchable style={[s.modBtn, !esLocal && s.modBtnActiva]} onPress={() => ciclarModalidad(idx)}>
                            <ModIcon mod={item.modalidad} color={esLocal ? C.textMuted : C.white} />
                            <Text style={[s.modBtnText, !esLocal && s.modBtnTextActiva]}>{modLabelText(item.modalidad)}</Text>
                            <Feather name="refresh-cw" size={12} color={esLocal ? C.textMuted : C.white} style={{marginLeft: 4}}/>
                          </Touchable>
                          <View style={s.carritoControles}>
                            <Touchable style={s.notaBtn} onPress={() => { setUi(prev => ({ ...prev, itemEditando: idx, notaInput: carrito[idx].nota || '', modalNota: true, notaCantidadMover: 1 })); }}><Feather name="file-text" size={18} color={C.textMuted} /></Touchable>
                            <View style={s.qtyControls}>
                              <Touchable style={s.qtyBtn} onPress={() => modificarCantidad(idx, -1)}><Feather name="minus" size={20} color={C.textDark} /></Touchable>
                              <Text style={s.qtyNumber}>{item.cantidad}</Text>
                              <Touchable style={s.qtyBtn} onPress={() => modificarCantidad(idx, 1)}><Feather name="plus" size={20} color={C.textDark} /></Touchable>
                            </View>
                            <Touchable style={s.eliminarBtn} onPress={() => {
                              modificarCantidad(idx, -item.cantidad);
                              if(carrito.length === 1) setCartVisible(false);
                            }}><Feather name="trash-2" size={18} color={C.danger} /></Touchable>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>

                <View style={s.carritoFooter}>
                  <Touchable style={s.btnPrimary} onPress={() => { setCartVisible(false); enviarComanda(); }}>
                    <Feather name="send" size={20} color={C.white} style={{marginRight: 8}} />
                    <Text style={s.btnPrimaryText}>Enviar a Cocina</Text>
                  </Touchable>
                </View>
              </View>
            </View>
          </Modal>

          {/* ─── MINI-MODAL PARA SEPARAR CANTIDADES ─── */}
          <Modal visible={uiSplit.visible} transparent animationType="fade">
            <View style={s.modalOverlay}>
              <View style={s.modalCard}>
                <Text style={s.modalTitle}>Separar Platos</Text>
                <Text style={s.modalSubtitle}>¿Cuántos deseas cambiar a {uiSplit.nextMod.toUpperCase()}?</Text>
                
                <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24, marginVertical: 20 }}>
                  <Touchable 
                    style={[s.qtyBtn, {backgroundColor: C.bg, width: 50, height: 50, borderRadius: 25}]} 
                    onPress={() => setUiSplit(p => ({...p, cantidadMover: Math.max(1, p.cantidadMover - 1)}))}
                  >
                    <Feather name="minus" size={24} color={C.textDark} />
                  </Touchable>
                  
                  <Text style={{ fontSize: 40, fontWeight: '800', color: C.textDark, minWidth: 50, textAlign: 'center' }}>
                    {uiSplit.cantidadMover}
                  </Text>
                  
                  <Touchable 
                    style={[s.qtyBtn, {backgroundColor: C.bg, width: 50, height: 50, borderRadius: 25}]} 
                    onPress={() => setUiSplit(p => ({...p, cantidadMover: Math.min(p.cantidadTotal, p.cantidadMover + 1)}))}
                  >
                    <Feather name="plus" size={24} color={C.textDark} />
                  </Touchable>
                </View>

                <Touchable style={[s.btnPrimary, {marginBottom: 10}]} onPress={confirmarSplit}>
                  <Text style={s.btnPrimaryText}>Confirmar</Text>
                </Touchable>
                <Touchable style={s.btnSecondary} onPress={() => setUiSplit({ visible: false, idx: null, nextMod: '', cantidadTotal: 0, cantidadMover: 1 })}>
                  <Text style={s.btnSecondaryText}>Cancelar</Text>
                </Touchable>
              </View>
            </View>
          </Modal>

          {/* Modal Nota con Fraccionamiento Integrado */}
          <Modal visible={ui.modalNota} transparent animationType="fade">
            <KeyboardAvoidingView behavior={Platform.OS === 'iOS' ? 'padding' : 'height'} style={s.modalOverlay}>
              <View style={s.modalCard}>
                <Text style={s.modalTitle}>Nota para cocina</Text>
                <Text style={s.modalSubtitle}>Ej: sin cebolla, poca sal</Text>
                <TextInput style={s.modalInput} placeholder="Escribe la nota..." placeholderTextColor={C.border} value={ui.notaInput} onChangeText={t => setUi(prev => ({ ...prev, notaInput: t }))} multiline />
                
                {/* Renderizado condicional del split si el mozo seleccionó un grupo */}
                {ui.itemEditando !== null && carrito[ui.itemEditando]?.cantidad > 1 && (
                  <View style={{ alignItems: 'center', marginBottom: 20 }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: C.textMuted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.3 }}>¿A cuántos platos aplicar nota?</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
                      <Touchable style={[s.qtyBtn, {backgroundColor: C.bg, width: 44, height: 44, borderRadius: 22}]} onPress={() => setUi(prev => ({ ...prev, notaCantidadMover: Math.max(1, prev.notaCantidadMover - 1) }))}>
                        <Feather name="minus" size={20} color={C.textDark} />
                      </Touchable>
                      <Text style={{ fontSize: 26, fontWeight: '800', color: C.textDark, minWidth: 40, textAlign: 'center' }}>{ui.notaCantidadMover}</Text>
                      <Touchable style={[s.qtyBtn, {backgroundColor: C.bg, width: 44, height: 44, borderRadius: 22}]} onPress={() => setUi(prev => ({ ...prev, notaCantidadMover: Math.min(carrito[ui.itemEditando].cantidad, prev.notaCantidadMover + 1) }))}>
                        <Feather name="plus" size={20} color={C.textDark} />
                      </Touchable>
                    </View>
                  </View>
                )}

                <Touchable style={s.btnPrimary} onPress={guardarNota}><Text style={s.btnPrimaryText}>Guardar Nota</Text></Touchable>
                <Touchable style={s.btnSecondary} onPress={() => setUi(prev => ({ ...prev, modalNota: false }))}><Text style={s.btnSecondaryText}>Cancelar</Text></Touchable>
              </View>
            </KeyboardAvoidingView>
          </Modal>

          <Modal visible={ui.modalDelivery} transparent animationType="fade">
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
              <View style={s.modalCard}>
                <Text style={s.modalTitle}>Datos de Delivery</Text><Text style={s.modalSubtitle}>¿A dónde enviamos este plato?</Text>
                <TextInput style={s.modalInputCompact} placeholder="Nombre del Cliente" placeholderTextColor={C.textMuted} value={ui.datosDelivery.nombre} onChangeText={t => setUi(prev => ({ ...prev, datosDelivery: { ...prev.datosDelivery, nombre: t } }))} />
                <TextInput style={s.modalInputCompact} placeholder="Dirección / Ref" placeholderTextColor={C.textMuted} value={ui.datosDelivery.direccion} onChangeText={t => setUi(prev => ({ ...prev, datosDelivery: { ...prev.datosDelivery, direccion: t } }))} />
                <TextInput style={s.modalInputCompact} placeholder="Teléfono (Opcional)" placeholderTextColor={C.textMuted} value={ui.datosDelivery.telefono} onChangeText={t => setUi(prev => ({ ...prev, datosDelivery: { ...prev.datosDelivery, telefono: t } }))} keyboardType="phone-pad" />
                <Touchable style={[s.btnPrimary, {backgroundColor: C.primary}]} onPress={confirmarDatosDelivery}><Text style={s.btnPrimaryText}>Confirmar Envío</Text></Touchable>
                <Touchable style={s.btnSecondary} onPress={() => setUi(prev => ({ ...prev, modalDelivery: false }))}><Text style={s.btnSecondaryText}>Cancelar</Text></Touchable>
              </View>
            </KeyboardAvoidingView>
          </Modal>

          <Modal visible={ui.modalFueraCarta} transparent animationType="fade">
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
              <View style={s.modalCard}>
                <Text style={s.modalTitle}>Plato Especial</Text><Text style={s.modalSubtitle}>Ingresa los datos del extra</Text>
                <TextInput style={s.modalInputCompact} placeholder="Nombre del plato" placeholderTextColor={C.textMuted} value={ui.fueraCartaItem.nombre} onChangeText={t => setUi(prev => ({ ...prev, fueraCartaItem: { ...prev.fueraCartaItem, nombre: t } }))} />
                <TextInput style={s.modalInputCompact} placeholder="Precio (S/)" placeholderTextColor={C.textMuted} value={ui.fueraCartaItem.precio} onChangeText={t => setUi(prev => ({ ...prev, fueraCartaItem: { ...prev.fueraCartaItem, precio: t } }))} keyboardType="decimal-pad" />
                <Touchable style={s.btnPrimary} onPress={guardarPlatoFueraCarta}><Text style={s.btnPrimaryText}>Añadir al pedido</Text></Touchable>
                <Touchable style={s.btnSecondary} onPress={() => setUi(prev => ({ ...prev, modalFueraCarta: false }))}><Text style={s.btnSecondaryText}>Cancelar</Text></Touchable>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        </>
      )}

      {/* ─── PANTALLA 5: MAPA DE MESAS ─── */}
      {!sys.modoConfig && authData.usuarioActivo && authData.usuarioActivo.rol !== 'admin' && (mozo.vistaActual !== 'comandar' || !mozo.mesaActiva) && (
        <>
          <View style={s.navbar}>
            <Text style={s.navBrand}>Calletano</Text>
            <View style={s.navRight}>
              <View style={[s.statusPill, sys.conectado ? s.statusPillOn : s.statusPillOff]}>
                <View style={[s.statusDot, { backgroundColor: sys.conectado ? C.success : C.danger }]} />
                <Text style={s.statusPillText} numberOfLines={1}>{sys.serverStatus}</Text>
              </View>
              <Touchable onPress={cerrarSesion} style={s.cfgIconBtn}><Feather name="log-out" size={20} color={C.surface} /></Touchable>
            </View>
          </View>

          <ScrollView style={s.scrollBase} contentContainerStyle={{ padding: 14, paddingBottom: 32 }} contentInsetAdjustmentBehavior="automatic">
            {elRestauranteEstaCerrado ? (
               <View style={{backgroundColor: C.dangerSoft, padding: 30, borderRadius: 16, alignItems: 'center', marginTop: 20, borderWidth: 1, borderColor: C.danger}}>
                  <Feather name="lock" size={40} color={C.danger} style={{marginBottom: 10}} />
                  <Text style={{color: C.danger, fontSize: 18, fontWeight: '800', textAlign: 'center'}}>RESTAURANTE CERRADO</Text>
                  <Text style={{color: C.danger, textAlign: 'center', marginTop: 10, fontWeight: '600'}}>El administrador ha cerrado el sistema de comandas por hoy.</Text>
               </View>
            ) : (
              <>
                <Text style={s.mesasSectionLabel}>SALÓN - Selecciona una mesa</Text>
                <View style={s.mesasGrid}>
                  {mesasOrdenadas.map(mesa => {
                    const ocupada = mesa.estado === 'ocupada';
                    return (
                      <Touchable key={mesa.id} style={[s.mesaCard, ocupada && s.mesaCardOcupada]} onPress={() => abrirMesa(mesa)}>
                        <View style={[s.mesaCardBar, { backgroundColor: ocupada ? C.danger : C.gold }]} />
                        <Text style={[s.mesaCardNombre, { color: ocupada ? C.textDark : C.gold }]} numberOfLines={1}>{formatMesaName(mesa.id)}</Text>
                        <View style={[s.mesaCardBadge, { backgroundColor: ocupada ? C.dangerSoft : C.goldSoft }]}><Text style={[s.mesaCardBadgeText, { color: ocupada ? C.danger : C.gold }]}>{ocupada ? 'Ocupada' : 'Libre'}</Text></View>
                        <View style={s.mesaCardFooter}><Text style={s.mesaCardItems}>{mesa.pedido?.length ?? 0} ítems</Text><Text style={[s.mesaCardTotal, mesa.total > 0 && s.mesaCardTotalActivo]}>S/ {(mesa.total ?? 0).toFixed(2)}</Text></View>
                      </Touchable>
                    );
                  })}
                </View>
              </>
            )}
            {appData.mesas.length === 0 && sys.conectado && !elRestauranteEstaCerrado && <Text style={s.emptyText}>No hay mesas configuradas.</Text>}
            {!sys.conectado && <Text style={s.emptyText}>Sin conexión · Verifica la IP en Ajustes</Text>}
          </ScrollView>
        </>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════
// ESTILOS 
// ═══════════════════════════════════════════════════════════
const PT = Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 0 : 0;

const s = StyleSheet.create({
  safeAreaBlue: { flex: 1, backgroundColor: C.primary, paddingTop: PT },
  scrollBase:   { flex: 1, backgroundColor: C.bg },
  cfgScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: C.bg },
  cfgCard: { backgroundColor: C.surface, borderRadius: 24, padding: 32, width: '100%', maxWidth: 380, borderWidth: 1, borderColor: C.borderFocus },
  cfgLogoWrap: { marginBottom: 24, alignItems: 'center' },
  cfgLogo:     { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 32, fontWeight: '700', color: C.gold, letterSpacing: -0.5 },
  cfgLogoSub:  { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: C.textMuted, marginTop: 6 },
  cfgDivider:  { height: 1, backgroundColor: C.border, marginBottom: 24 },
  cfgLabel:    { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase' },
  cfgInput: { backgroundColor: C.surface, color: C.textDark, fontSize: 18, fontWeight: '700', textAlign: 'center', letterSpacing: 1, borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: C.borderFocus },
  navbar: { backgroundColor: C.primary, height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: C.gold },
  navBrand: { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 24, fontWeight: '700', color: C.gold },
  navTitle: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 20, fontWeight: '700', color: C.surface, pointerEvents: 'none' },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  navBackBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, marginLeft: -4 },
  navBackText: { color: C.surface, fontWeight: '700', fontSize: 16, marginLeft: 2 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, backgroundColor: C.primarySoft, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusPillText: { fontSize: 12, fontWeight: '700', color: C.surface, textTransform: 'uppercase', letterSpacing: 0.5 },
  cfgIconBtn: { padding: 10 },
  mesasSectionLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: C.textMuted, marginBottom: 16, marginLeft: 4, textTransform: 'uppercase' },
  mesasGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  mesaCard: { width: (SW - 40) / 2, backgroundColor: C.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  mesaCardOcupada: { backgroundColor: C.surface, borderColor: C.danger, borderWidth: 2 },
  mesaCardBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 4 },
  mesaCardNombre: { fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 16, marginBottom: 16 },
  mesaCardBadge: { alignSelf: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginBottom: 12, borderWidth: 1 },
  mesaCardBadgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  mesaCardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  mesaCardItems: { fontSize: 12, color: C.textMuted, fontWeight: '700' },
  mesaCardTotal: { fontSize: 14, fontWeight: '800', color: C.textMuted },
  mesaCardTotalActivo: { color: C.primary, fontWeight: '800' },
  emptyText: { color: C.textMuted, textAlign: 'center', marginTop: 40, fontSize: 14, fontWeight: '600' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 16, marginBottom: 20, borderWidth: 1, borderColor: C.borderFocus },
  searchIcon: { marginRight: 12 },
  searchInput: { flex: 1, color: C.textDark, fontSize: 16, fontWeight: '600', paddingVertical: 16 },
  searchClear: { padding: 8 },
  quickGrid: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  quickBtn: { flex: 1, borderRadius: 12, padding: 16, alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  quickBtnLabel: { color: C.primary, fontWeight: '800', fontSize: 14, marginBottom: 4 },
  quickBtnPrice: { color: C.textMuted, fontWeight: '700', fontSize: 13 },
  fueraCarta: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: C.bg, borderRadius: 12, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: C.borderFocus, borderStyle: 'dashed' },
  fueraCartaText: { color: C.textDark, fontWeight: '700', fontSize: 14 },
  yaPedidoCard: { backgroundColor: C.surface, borderRadius: 12, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: C.border },
  yaPedidoTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: C.primary, marginLeft: 6, textTransform: 'uppercase' },
  yaPedidoRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  yaPedidoItem: { fontSize: 14 },
  seccionWrap: { marginBottom: 24 },
  seccionTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: C.textMuted, textTransform: 'uppercase', paddingBottom: 8, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  catLabel: { fontSize: 12, fontWeight: '800', color: C.primary, textTransform: 'uppercase', marginBottom: 12, marginTop: 4 },
  platosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  platoBtn: { width: (SW - 36) / 2, backgroundColor: C.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.border },
  platoBtnBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  platoNombre: { color: C.textDark, fontWeight: '700', fontSize: 14, lineHeight: 18, marginTop: 8, marginBottom: 8 },
  platoPrecio: { fontWeight: '800', fontSize: 15 },
  carritoSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '55%', borderWidth: 1, borderColor: C.borderFocus },
  carritoHandle: { alignItems: 'center', paddingTop: 12, paddingBottom: 12 },
  carritoHandleBar: { width: 48, height: 4, backgroundColor: C.borderFocus, borderRadius: 99 },
  carritoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  carritoHeaderTitle: { fontSize: 14, fontWeight: '800', color: C.textDark, textTransform: 'uppercase', letterSpacing: 0.5 },
  carritoHeaderBadge: { backgroundColor: C.primary, width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  carritoHeaderBadgeText:{ color: C.surface, fontWeight: '800', fontSize: 13 },
  carritoLista: { paddingHorizontal: 16, maxHeight: 200 },
  carritoItem: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  carritoItemRow1: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  carritoItemNombre:{ color: C.textDark, fontWeight: '700', fontSize: 15, flex: 1, lineHeight: 22 },
  carritoItemNota: { color: C.danger, fontSize: 12, marginTop: 6, fontWeight: '600' },
  carritoItemPrecio:{ color: C.textMuted, fontWeight: '800', fontSize: 15, marginLeft: 12 },
  carritoItemRow2: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  modBtnActiva: { backgroundColor: C.primary, borderColor: C.primary },
  modBtnText: { color: C.textDark, fontWeight: '700', fontSize: 12, marginLeft: 6 },
  modBtnTextActiva: { color: C.surface },
  carritoControles: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notaBtn: { width: 40, height: 40, borderRadius: 8, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  qtyControls: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  qtyBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  qtyNumber: { color: C.textDark, fontWeight: '800', fontSize: 16, minWidth: 28, textAlign: 'center' },
  eliminarBtn: { width: 40, height: 40, borderRadius: 8, backgroundColor: C.dangerSoft, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.dangerSoft },
  carritoFooter: { padding: 16, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg },
  btnPrimary: { backgroundColor: C.primary, borderRadius: 12, padding: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  btnPrimaryText: { color: C.surface, fontWeight: '800', fontSize: 15, textTransform: 'uppercase', letterSpacing: 0.5 },
  btnSecondary: { padding: 16, alignItems: 'center', marginTop: 4 },
  btnSecondaryText: { color: C.textMuted, fontWeight: '800', fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: 'center', alignItems: 'center' },
  modalCard: { backgroundColor: C.surface, borderRadius: 24, padding: 24, width: '85%', borderWidth: 1, borderColor: C.borderFocus },
  modalTitle: { fontSize: 20, fontWeight: '800', color: C.textDark, marginBottom: 8 },
  modalSubtitle: { fontSize: 13, color: C.textMuted, marginBottom: 24, fontWeight: '600' },
  modalInput: { backgroundColor: C.bg, color: C.textDark, borderRadius: 12, padding: 16, fontSize: 16, fontWeight: '500', marginBottom: 24, minHeight: 100, textAlignVertical: 'top', borderWidth: 1, borderColor: C.border },
  modalInputCompact: { backgroundColor: C.bg, color: C.textDark, borderRadius: 12, padding: 16, fontSize: 16, fontWeight: '500', marginBottom: 12, borderWidth: 1, borderColor: C.border },
  fabBtn: {
    position: 'absolute', bottom: 24, right: 24,
    backgroundColor: C.primary, width: 64, height: 64, borderRadius: 32,
    justifyContent: 'center', alignItems: 'center', elevation: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 4
  },
  fabBadge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: C.danger, width: 28, height: 28, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: C.surface
  },
  fabBadgeText: { color: C.surface, fontWeight: '800', fontSize: 13 },
  badgeComanda: { position: 'absolute', top: -8, right: -8, backgroundColor: C.success, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 2, borderColor: C.surface, elevation: 2, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.2, shadowRadius: 2, zIndex: 10 },
  badgeComandaText: { color: C.surface, fontWeight: '800', fontSize: 10, textTransform: 'uppercase' },
});