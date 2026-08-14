import React, { useEffect, useRef } from 'react';
import {
  View, Text, TextInput, ScrollView,
  Modal, Platform,
  KeyboardAvoidingView, BackHandler, RefreshControl, Pressable, PanResponder, useWindowDimensions
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';

// 🟢 TUS IMPORTACIONES MODULARES
import { C, s, CAT } from '../src/styles/theme';
import { obtenerFechaActualLocal, formatMesaName, modLabelText, obtenerHistorialCambios } from '../src/utils/helpers';
import { CameraView, useCameraPermissions } from 'expo-camera';
import useAppSystem from '../src/hooks/useAppSystem';
import useAdmin from '../src/hooks/useAdmin';
import useMozo from '../src/hooks/useMozo';
import useClub, { CONSUMO_MINIMO } from '../src/hooks/useClub';
import useClubAdmin from '../src/hooks/useClubAdmin';
import { calcularProgreso, enmascararDocumento } from '../src/utils/club';

// ─── COMPONENTES PUROS EXTRAÍDOS ───
const ModIcon = ({ mod, color }: { mod: string, color: string }) => {
  if (mod === 'local') return <MaterialCommunityIcons name="silverware-fork-knife" size={16} color={color} />;
  if (mod === 'llevar') return <Feather name="shopping-bag" size={16} color={color} />;
  return <MaterialCommunityIcons name="motorbike" size={18} color={color} />;
};

const Touchable = ({ style, activeOpacity = 0.7, children, disabled, onPress, hitSlop, accessibilityLabel, accessibilityRole }: any) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    hitSlop={hitSlop}
    accessibilityLabel={accessibilityLabel}
    accessibilityRole={accessibilityRole}
    style={({ pressed }) => {
      const baseStyle = typeof style === 'function' ? style({ pressed }) : style;
      return [baseStyle, { opacity: pressed && !disabled ? activeOpacity : (disabled ? 0.5 : 1) }];
    }}
  >
    {children}
  </Pressable>
);

export default function App() {

  // 🟢 1. Cerebro principal (Red, Sockets y Login)
  const { sys, setSys, authData, setAuthData, appData, setAppData, guardarIP, handleLogin, toggleEstadoLocal,
    loginRole, setLoginRole, handleMozoLogin
  } = useAppSystem(() => {
    cargarReporteDueño();
    cargarRadarTributario(undefined, true); // 🟢 Cargar radar TAMBIÉN al entrar como admin
  });

  // 🟢 2. Lógica del Dueño / Administrador
  const { 
    admin, setAdmin, cargarReporteDueño, cargarRadarTributario, navegarMes, eliminarGastoAdmin, guardarGastoAdmin, onRefreshAdmin,
    abrirEditorMenu, guardarAdminMenu, updateAdminMenu, toggleDomingoAdmin, updateMenuArr, toggleTaperMenu,
    addMenuRow, delMenuRow, marcarImpuestoPagado, addDefaultDomingoPlato, PLATOS_DEFAULT_DOMINGO, aplicarGuarnicionGlobal,
    abrirContacto, guardarContacto
  } = useAdmin(appData, setAppData, sys.ipServidor);

  // 🟢 3. Lógica del Mozo / Comandera
  const { 
    mozo, setMozo, carrito, cartVisible, setCartVisible,
    uiSplit, setUiSplit, ui, setUi, totalItems,
    abrirMesa, agregarAlCarrito, modificarCantidad, calcularRecargoTaperMozo,
    ciclarModalidad, confirmarSplit, confirmarDatosDelivery, guardarPlatoFueraCarta,
    guardarNota, enviarComanda, asignarBebidasAlmuerzos, removerBebidaAsignada
  } = useMozo(sys.ipServidor, appData);

  // 🎫 Club Calletano — escáner de visitas de clientes
  const club = useClub(sys.ipServidor);
  // 🎫 Club Calletano — panel de socios (solo Dueño)
  const clubAdmin = useClubAdmin(sys.ipServidor);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const clubProg = club.miembro ? calcularProgreso(club.miembro.visitas, club.meta) : null;
  // 💵 La visita solo se registra si el mozo confirma consumo de comida >= S/ 80
  const consumoOk = parseFloat(club.consumoMesa) >= CONSUMO_MINIMO;

  // 🟢 Responsive: dimensiones dinámicas para tablet/rotación
  const { width: SCREEN_W } = useWindowDimensions();
  const isTablet = SCREEN_W >= 600;
  // 🟢 Grid fijo de 3 columnas para simular disposición 3×4
  const COLS = 3;
  const GAP = isTablet ? 16 : 12;
  const PADDING = isTablet ? 24 : 14;
  // Ancho exacto de cada card; usamos justifyContent:'space-between' para crear el gap
  const CARD_WIDTH = (SCREEN_W - PADDING * 2 - GAP * (COLS - 1)) / COLS;
  // 🟢 Catálogo de platos: 2 columnas para mejor legibilidad
  const PLATO_CARD_WIDTH = (SCREEN_W - PADDING * 2 - GAP) / 2;

  useEffect(() => {
    const backAction = () => {
      if (authData.usuarioActivo && authData.usuarioActivo.rol !== 'admin' && mozo.vistaActual === 'comandar') {
        setMozo(prev => ({ ...prev, vistaActual: 'mesas' }));
        return true; 
      }
      return false; 
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove(); 
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mozo.vistaActual, authData.usuarioActivo]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderRelease: (e, gestureState) => {
        if (gestureState.dy > 50) setCartVisible(false);
      }
    })
  ).current;

  const cerrarSesion = () => {
    setAuthData(prev => ({ ...prev, usuarioActivo: null, username: '', password: '' }));
    setMozo(prev => ({ ...prev, vistaActual: 'mesas' }));
  };

  const mesasOrdenadas = appData.mesas.slice()
    .filter((m: any) => !String(m.id).startsWith('CTA-') && !String(m.id).startsWith('DEL-') && !String(m.id).startsWith('REC-')) // 🟢 FILTRO DE MOZOS
    .sort((a: any, b: any) => {
      const numA = parseInt(String(a.id).replace(/\D/g, ''));
      const numB = parseInt(String(b.id).replace(/\D/g, ''));
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return String(a.id).localeCompare(String(b.id));
  });

  // 🟢 Ordenar en patrón serpiente 3×4 (1-2-3 / 6-5-4 / 7-8-9 / 12-11-10)
  const mesasSnakeOrder = (() => {
    const cols = 3;
    const result: any[] = [];
    const rows = Math.ceil(mesasOrdenadas.length / cols);
    for (let row = 0; row < rows; row++) {
      const start = row * cols;
      const end = Math.min(start + cols, mesasOrdenadas.length);
      const rowItems = mesasOrdenadas.slice(start, end);
      if (row % 2 === 0) {
        result.push(...rowItems); // Fila par: izquierda → derecha
      } else {
        result.push(...rowItems.reverse()); // Fila impar: derecha → izquierda
      }
    }
    return result;
  })();

  const insets = useSafeAreaInsets();
  const elRestauranteEstaCerrado = appData.estadoRestaurante.cierreForzado === obtenerFechaActualLocal();

  // 🟢 Obtener configuración visual de una categoría
  const getCatConf = (nombre: string) => {
    const n = nombre.toLowerCase().trim();
    if (n === 'entradas') return CAT.entradas;
    if (n === 'segundos') return CAT.segundos;
    if (n === 'bebidas' || n.startsWith('bebida')) return CAT.bebidas;
    return CAT.otro;
  };

  // 🟢 Formatear YYYY-MM a "MES AÑO" (ej: "JULIO 2026")
  const formatMes = (ym: string) => {
    const [y, m] = ym.split('-');
    const meses = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
    return `${meses[parseInt(m)-1]} ${y}`;
  };

  return (
    <SafeAreaView edges={['top']} style={s.safeAreaBlue}>
      <StatusBar style="light" hidden={true} />
      
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

      {/* ─── PANTALLA 2: LOGIN CON SELECCIÓN DE ROL ─── */}
      {!sys.modoConfig && !authData.usuarioActivo && (
        <View style={s.cfgScreen}>
          <View style={s.cfgCard}>
            <View style={s.cfgLogoWrap}>
              <Text style={s.cfgLogo}>Calletano</Text>
              <Text style={s.cfgLogoSub}>SISTEMA DE CONTROL</Text>
            </View>
            
            {authData.error !== '' && (
              <Text style={{color: C.danger, textAlign: 'center', marginBottom: 15, fontWeight: '800', fontSize: 13}}>{authData.error}</Text>
            )}

            {/* 🆕 SELECCIONADOR DE ROL */}
            {loginRole === null && (
              <>
                <Text style={{fontSize: 11, fontWeight: '700', color: C.textMuted, textAlign: 'center', marginBottom: 24, letterSpacing: 1.5, textTransform: 'uppercase'}}>Acceder como</Text>
                <Touchable 
                  style={{backgroundColor: C.surface, borderRadius: 14, padding: 24, marginBottom: 12, borderWidth: 1.5, borderColor: C.gold, alignItems: 'center', boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)', elevation: 3}}
                  onPress={() => { setLoginRole('dueno'); setAuthData(prev => ({...prev, error: ''})); }}
                >
                  <View style={{width: 48, height: 48, borderRadius: 24, backgroundColor: C.goldSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 12}}>
                    <Feather name="user-check" size={24} color={C.gold} />
                  </View>
                  <Text style={{fontSize: 17, fontWeight: '700', color: C.textDark, marginBottom: 4, letterSpacing: -0.3}}>Administrador</Text>
                  <Text style={{fontSize: 12, color: C.textMuted, fontWeight: '500', textAlign: 'center', lineHeight: 18}}>Reportes, control de inventario,{`\n`}gestión del menú y configuración</Text>
                </Touchable>
                <Touchable 
                  style={{backgroundColor: C.surface, borderRadius: 14, padding: 24, marginBottom: 28, borderWidth: 1.5, borderColor: C.borderFocus, alignItems: 'center', boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)', elevation: 3}}
                  onPress={handleMozoLogin}
                >
                  <View style={{width: 48, height: 48, borderRadius: 24, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', marginBottom: 12}}>
                    <Feather name="users" size={24} color={C.textDark} />
                  </View>
                  <Text style={{fontSize: 17, fontWeight: '700', color: C.textDark, marginBottom: 4, letterSpacing: -0.3}}>Mozo</Text>
                  <Text style={{fontSize: 12, color: C.textMuted, fontWeight: '500', textAlign: 'center', lineHeight: 18}}>Tomar pedidos en mesas,{`\n`}enviar comandas a cocina</Text>
                </Touchable>
                <Touchable style={{alignItems: 'center', padding: 8}} onPress={() => setSys(prev => ({ ...prev, modoConfig: true }))}>
                  <Text style={{color: C.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 0.3}}>Configurar conexión</Text>
                </Touchable>
              </>
            )}

            {/* 🟢 LOGIN DUEÑO */}
            {loginRole === 'dueno' && (
              <>
                <Touchable onPress={() => { setLoginRole(null); setAuthData(prev => ({...prev, error: ''})); }} style={{marginBottom: 16, alignSelf: 'flex-start'}}>
                  <Text style={{color: C.textMuted, fontSize: 12, fontWeight: '800'}}>← VOLVER</Text>
                </Touchable>
                <TextInput style={[s.cfgInput, {textAlign: 'left'}]} placeholder="Usuario" placeholderTextColor={C.textMuted} value={authData.username} onChangeText={t => setAuthData(prev => ({ ...prev, username: t }))} autoCapitalize="none" />
                <TextInput style={[s.cfgInput, {textAlign: 'left', marginBottom: 25}]} placeholder="Contraseña" placeholderTextColor={C.textMuted} value={authData.password} onChangeText={t => setAuthData(prev => ({ ...prev, password: t }))} secureTextEntry />
                <Touchable style={s.btnPrimary} onPress={handleLogin}>
                  <Text style={s.btnPrimaryText}>Ingresar como Dueño</Text>
                </Touchable>
              </>
            )}

            {/* 🟢 LOGIN MOZO (ya no necesita PIN) — se autentica directo al hacer clic */}
          </View>
        </View>
      )}

      {/* ─── PANTALLA 3: APP DEL DUEÑO ─── */}
      {!sys.modoConfig && authData.usuarioActivo && authData.usuarioActivo.rol === 'admin' && (
        <>
          <View style={s.navbar}>
            <Text style={s.navBrand}>Dueño <Text style={{fontSize: 14, color: C.gold}}>POS</Text></Text>
            <View style={s.navRight}>
              <View style={[s.statusPill, { backgroundColor: sys.conectado ? 'rgba(16, 185, 129, 0.08)' : 'rgba(215, 38, 61, 0.08)', borderColor: sys.conectado ? 'rgba(16, 185, 129, 0.3)' : 'rgba(215, 38, 61, 0.3)' }]}>
                <View style={[s.statusDot, { backgroundColor: sys.conectado ? C.success : C.danger }]} />
                <Text style={s.statusPillText} numberOfLines={1}>{sys.serverStatus}</Text>
              </View>
              <Touchable onPress={club.abrirClub} style={s.cfgIconBtn} accessibilityLabel="Club Calletano" accessibilityRole="button"><Feather name="credit-card" size={20} color={C.surface} /></Touchable>
              <Touchable onPress={cerrarSesion} style={s.cfgIconBtn} accessibilityLabel="Cerrar sesión" accessibilityRole="button"><Feather name="log-out" size={20} color={C.surface} /></Touchable>
            </View>
          </View>

          <ScrollView style={s.scrollBase} contentContainerStyle={{ padding: PADDING, paddingBottom: 40 }} contentInsetAdjustmentBehavior="automatic" refreshControl={<RefreshControl refreshing={admin.refreshing} onRefresh={onRefreshAdmin} tintColor={C.gold} />}>
            <Text style={s.seccionTitle}>ACCIONES ADMINISTRATIVAS</Text>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24}}>
               <Touchable style={[s.quickBtn, {backgroundColor: C.surface, borderColor: C.gold, flex: 1, minWidth: 100}]} onPress={abrirEditorMenu}>
                  <Feather name="edit-3" size={22} color={C.gold} style={{marginBottom: 6}}/>
                  <Text style={{fontSize: 12, fontWeight: '800', color: C.textDark}}>EDITAR MENÚ</Text>
               </Touchable>
               <Touchable style={[s.quickBtn, {backgroundColor: C.surface, borderColor: C.danger, flex: 1, minWidth: 100}]} onPress={() => setAdmin(prev => ({ ...prev, modalGasto: true }))}>
                  <Feather name="dollar-sign" size={22} color={C.danger} style={{marginBottom: 6}}/>
                  <Text style={{fontSize: 12, fontWeight: '800', color: C.textDark}}>NUEVO GASTO</Text>
               </Touchable>

               <Touchable style={[s.quickBtn, {backgroundColor: C.surface, borderColor: C.teal, flex: 1, minWidth: 100}]} onPress={abrirContacto}>
                  <Feather name="phone" size={22} color={C.teal} style={{marginBottom: 6}}/>
                  <Text style={{fontSize: 12, fontWeight: '800', color: C.textDark}}>CONTACTO</Text>
               </Touchable>

               {/* 🎫 Club Calletano: lista de socios y canje de premios (solo Dueño) */}
               <Touchable style={[s.quickBtn, {backgroundColor: C.surface, borderColor: C.gold, flex: 1, minWidth: 100}]} onPress={clubAdmin.abrirSocios}>
                  <Feather name="users" size={22} color={C.gold} style={{marginBottom: 6}}/>
                  <Text style={{fontSize: 12, fontWeight: '800', color: C.textDark}}>SOCIOS CLUB</Text>
               </Touchable>
            </View>

            {/* 🟢 RADAR TRIBUTARIO PRIVADO DEL DUEÑO */}
            <Text style={s.seccionTitle}>RADAR TRIBUTARIO SUNAT (S/ 5,000)</Text>
            
            {/* 🟢 Navegador de meses */}
            <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, backgroundColor: C.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border}}>
              <Touchable onPress={() => navegarMes(-1)} style={{padding: 12, borderRadius: 8, backgroundColor: C.bg}} accessibilityLabel="Mes anterior" accessibilityRole="button">
                <Feather name="chevron-left" size={22} color={C.primary} />
              </Touchable>
              <View style={{alignItems: 'center'}}>
                <Text style={{fontSize: 16, fontWeight: '800', color: C.textDark, letterSpacing: 0.5}}>
                  {formatMes(admin.radarMonth)}
                </Text>
                <Text style={{fontSize: 12, color: C.textMuted, fontWeight: '600', marginTop: 2}}>
                  {admin.radarMonth === obtenerFechaActualLocal().slice(0, 7) ? 'MES ACTUAL' : 'HISTÓRICO'}
                </Text>
              </View>
              <Touchable 
                onPress={() => navegarMes(1)} 
                style={{padding: 12, borderRadius: 8, backgroundColor: admin.radarMonth === obtenerFechaActualLocal().slice(0, 7) ? C.border : C.bg}}
                accessibilityLabel="Mes siguiente" accessibilityRole="button">
                <Feather name="chevron-right" size={22} color={admin.radarMonth === obtenerFechaActualLocal().slice(0, 7) ? C.textMuted : C.primary} />
              </Touchable>
            </View>

            <View style={{backgroundColor: C.surface, borderRadius: 16, padding: 20, marginBottom: 24, borderWidth: 2, borderColor: C.gold}}>
               
               {admin.radarMonth === obtenerFechaActualLocal().slice(0, 7) && new Date().getDate() <= 20 && appData.estadoRestaurante.mesImpuestoPagado !== obtenerFechaActualLocal().slice(0, 7) && (
                 <View style={{backgroundColor: C.dangerSoft, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: C.danger, marginBottom: 20}}>
                   <Text style={{color: C.danger, fontWeight: '800', fontSize: 13, textAlign: 'center', marginBottom: 10}}>🚨 ¡HOY TOCA PAGAR LOS S/ 20 A SUNAT!</Text>
                   <Touchable style={[s.btnPrimary, {backgroundColor: C.danger, padding: 10}]} onPress={marcarImpuestoPagado}>
                     <Text style={s.btnPrimaryText}>Ya lo pagué ✔️</Text>
                   </Touchable>
                 </View>
               )}

               <Text style={{fontSize: 11, color: C.textMuted, marginBottom: 12, textAlign: 'center'}}>
                 Acumulado de {formatMes(admin.radarMonth)} — Límite S/ 5,000
               </Text>
               {/* Ventas */}
               <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8}}>
                 <Text style={{fontWeight: '800', color: C.successDark, fontSize: 12}}>VENTAS BOLETA</Text>
                 <Text style={{fontWeight: '800'}}>S/ {(admin.radarMensual?.ventasSunat || 0).toFixed(2)}</Text>
               </View>
               <View style={{height: 10, backgroundColor: C.bg, borderRadius: 5, marginBottom: 20, overflow: 'hidden'}}>
                 <View style={{height: '100%', backgroundColor: C.success, width: `${Math.min(100, ((admin.radarMensual?.ventasSunat || 0) / 5000) * 100)}%`}} />
               </View>

               {/* Gastos */}
               <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8}}>
                 <Text style={{fontWeight: '800', color: C.teal, fontSize: 12}}>COMPRAS FACTURADAS</Text>
                 <Text style={{fontWeight: '800'}}>S/ {(admin.radarMensual?.gastosSunat || 0).toFixed(2)}</Text>
               </View>
               <View style={{height: 10, backgroundColor: C.bg, borderRadius: 5, overflow: 'hidden'}}>
                 <View style={{height: '100%', backgroundColor: C.teal, width: `${Math.min(100, ((admin.radarMensual?.gastosSunat || 0) / 5000) * 100)}%`}} />
               </View>
            </View>
            <Text style={s.seccionTitle}>ARQUEO EN VIVO (HOY)</Text>
            <View style={{backgroundColor: C.surface, borderRadius: 16, padding: 24, marginBottom: 24, borderWidth: 1, borderColor: C.border}}>
              <Text style={{fontSize: 12, fontWeight: '800', color: C.textMuted, letterSpacing: 1, marginBottom: 8}}>INGRESO BRUTO</Text>
              <Text style={{fontSize: 36, fontWeight: '800', color: C.successDark, marginBottom: 24}}>S/ {admin.reporte?.totales?.totalVentas?.toFixed(2) || '0.00'}</Text>
              <Text style={{fontSize: 12, fontWeight: '800', color: C.textMuted, letterSpacing: 1, marginBottom: 8}}>EGRESOS REGISTRADOS</Text>
              <Text style={{fontSize: 24, fontWeight: '800', color: C.danger, marginBottom: 24}}>S/ {admin.reporte?.totales?.totalGastos?.toFixed(2) || '0.00'}</Text>
              <View style={{height: 1, backgroundColor: C.border, marginVertical: 10, marginBottom: 20}} />
              <Text style={{fontSize: 12, fontWeight: '800', color: C.goldText, letterSpacing: 1, marginBottom: 8}}>GANANCIA NETA OPERATIVA</Text>
              <Text style={{fontSize: 28, fontWeight: '800', color: C.primary}}>S/ {admin.reporte?.totales?.balance?.toFixed(2) || '0.00'}</Text>
              
              {/* 🆕 DESGLOSE POR MÉTODO DE PAGO */}
              {admin.reporte?.pagos && (
                <>
                  <View style={{height: 1, backgroundColor: C.border, marginVertical: 20}} />
                  <Text style={{fontSize: 12, fontWeight: '800', color: C.textMuted, letterSpacing: 1, marginBottom: 16}}>DESGLOSE POR PAGO</Text>                      {[
                    {label: 'Efectivo', value: admin.reporte.pagos.efectivo, color: C.success},
                    {label: 'Yape', value: admin.reporte.pagos.yape, color: C.teal},
                    {label: 'Plin', value: admin.reporte.pagos.plin, color: C.danger},
                    {label: 'Tarjeta', value: admin.reporte.pagos.tarjeta, color: C.primary}
                  ].filter(p => p.value > 0).map(p => (
                    <View key={p.label} style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8}}>
                      <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                        <View style={{width: 10, height: 10, borderRadius: 5, backgroundColor: p.color}} />
                        <Text style={{fontSize: 12, fontWeight: '600', color: C.textMuted}}>{p.label}</Text>
                      </View>
                      <Text style={{fontSize: 13, fontWeight: '800', color: C.textDark}}>S/ {p.value.toFixed(2)}</Text>
                    </View>
                  ))}
                </>
              )}
            </View>

            {/* 🟢 BOLETAS SUNAT EMITIDAS HOY */}
            <Text style={s.seccionTitle}>BOLETAS SUNAT EMITIDAS HOY</Text>
            <View style={{backgroundColor: C.surface, borderRadius: 16, padding: 20, marginBottom: 24, borderWidth: 1, borderColor: C.gold}}>
              <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16}}>
                <View style={{flex: 1}}>
                  <Text style={{fontSize: 11, fontWeight: '800', color: C.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4}}>MONTO DECLARADO</Text>
                  <Text style={{fontSize: 32, fontWeight: '800', color: C.successDark}}>
                    S/ {admin.reporte?.totales?.ventasSunatHoy?.toFixed(2) || '0.00'}
                  </Text>
                </View>
                <View style={{alignItems: 'center', backgroundColor: C.successSoft, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12}}>
                  <Text style={{fontSize: 28, fontWeight: '800', color: C.successDark}}>
                    {admin.reporte?.totales?.cantBoletasSunat || 0}
                  </Text>
                  <Text style={{fontSize: 12, fontWeight: '800', color: C.successDark, textTransform: 'uppercase', letterSpacing: 0.5}}>Boletas</Text>
                </View>
              </View>
              <View style={{height: 1, backgroundColor: C.border, marginBottom: 12}} />
              <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1}}>
                  <Feather name="info" size={12} color={C.textMuted} />
                  <Text style={{fontSize: 12, color: C.textMuted, fontWeight: '600', flex: 1}}>
                    Solo boletas con envío exitoso a SUNAT
                  </Text>
                </View>
                {(admin.reporte?.totales?.cantBoletasSunat || 0) > 0 && (
                  <Feather name="check-circle" size={20} color={C.success} />
                )}
              </View>

              {/* 🆕 Detalle de cada boleta SUNAT (hora, mesa y monto) */}
              {(admin.reporte?.boletasSunat?.length || 0) > 0 && (
                <View style={{ marginTop: 14, gap: 8 }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: C.textMuted, letterSpacing: 1, textTransform: 'uppercase' }}>
                    DETALLE DE BOLETAS
                  </Text>
                  {(admin.reporte.boletasSunat || []).map((b: any, i: number) => (
                    <View
                      key={i}
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: C.border }}
                    >
                      <View style={{ width: 52 }}>
                        <Text style={{ fontSize: 12, fontWeight: '800', color: C.textDark }}>{b.hora}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: C.primary }} numberOfLines={1}>
                          {formatMesaName(b.mesa)}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: C.successDark }}>
                        S/ {(b.monto || 0).toFixed(2)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
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
                    <Touchable onPress={() => eliminarGastoAdmin(g.id)} style={{padding: 8}} accessibilityLabel="Eliminar gasto" accessibilityRole="button">
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
               <Touchable style={[s.btnPrimary, {width: '100%', backgroundColor: elRestauranteEstaCerrado ? C.successLight : C.danger}]} onPress={toggleEstadoLocal}>
                 <Text style={[s.btnPrimaryText, elRestauranteEstaCerrado ? {color: '#064E3B'} : null]}>{elRestauranteEstaCerrado ? 'ABRIR RESTAURANTE AHORA' : 'CERRAR POR HOY'}</Text>
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
                <Touchable 
                   style={{flexDirection: 'row', alignItems: 'center', backgroundColor: admin.gastoData.con_comprobante ? C.successSoft : C.bg, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: admin.gastoData.con_comprobante ? C.success : C.border, marginBottom: 20}} 
                   onPress={() => setAdmin(prev => ({ ...prev, gastoData: { ...prev.gastoData, con_comprobante: !prev.gastoData.con_comprobante } }))}
                >
                   <MaterialCommunityIcons name={admin.gastoData.con_comprobante ? "checkbox-marked" : "checkbox-blank-outline"} size={24} color={admin.gastoData.con_comprobante ? C.success : C.textMuted} />
                   <Text style={{marginLeft: 10, fontWeight: '800', color: admin.gastoData.con_comprobante ? C.success : C.textDark}}>Tengo Factura/Boleta (SUNAT)</Text>
                </Touchable>
                <Touchable style={[s.btnPrimary, {backgroundColor: C.danger}]} onPress={guardarGastoAdmin}><Text style={s.btnPrimaryText}>Guardar Gasto</Text></Touchable>
                <Touchable style={s.btnSecondary} onPress={() => setAdmin(prev => ({ ...prev, modalGasto: false }))}><Text style={s.btnSecondaryText}>Cancelar</Text></Touchable>
              </View>
            </KeyboardAvoidingView>
          </Modal>

          {/* Modal Editor Menú */}
          <Modal visible={admin.modalMenu} animationType="slide">
            <SafeAreaView style={{flex: 1, backgroundColor: C.bg}}>
              <View style={[s.navbar, {justifyContent: 'space-between'}]}>
                 <Touchable onPress={() => setAdmin(prev => ({ ...prev, modalMenu: false }))} style={{padding: 10}} accessibilityLabel="Cerrar editor de menú" accessibilityRole="button"><Feather name="x" size={26} color={C.surface} /></Touchable>
                 <Text style={[s.navTitle, {fontSize: 18}]}>Editor de Menú</Text>
                 <Touchable onPress={guardarAdminMenu} style={{padding: 10}} accessibilityLabel="Guardar menú" accessibilityRole="button"><Feather name="check" size={26} color={C.surface} /></Touchable>
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
                         <Text style={{fontWeight: '800', color: C.goldText, fontSize: 16}}>ENTRADAS</Text>
                         <Touchable onPress={() => addMenuRow('entradas')}><Text style={{color: C.goldText, fontWeight: '800', fontSize: 14}}>+ Añadir</Text></Touchable>
                      </View>
                      {(admin.menuData.entradas||[]).map((e: any, idx: number) => (
                        <View key={e.id || `ent-${idx}`} style={{backgroundColor: C.surface, padding: 12, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: C.border}}>
                           <View style={{flexDirection: 'row', gap: 8}}>
                             <TextInput style={[s.modalInputCompact, {flex: 1, marginBottom: 0, paddingVertical: 10}]} placeholder="Nombre de Entrada" value={e.nombre} onChangeText={t => updateMenuArr('entradas', idx, 'nombre', t)} />
                             <View style={{alignItems: 'center'}}>
                               <Text style={{fontSize: 12, color: C.primary, fontWeight: 'bold', marginBottom: 2}}>PRECIO S/</Text>
                               <TextInput style={[s.modalInputCompact, {width: 60, marginBottom: 0, paddingVertical: 10, textAlign: 'center'}]} placeholder="S/" value={String(e.precio)} onChangeText={t => updateMenuArr('entradas', idx, 'precio', t)} keyboardType="decimal-pad" />
                             </View>
                             <View style={{alignItems: 'center'}}>
                               <Text style={{fontSize: 12, color: C.teal, fontWeight: 'bold', marginBottom: 2}}>STOCK</Text>
                               <TextInput style={[s.modalInputCompact, {width: 60, marginBottom: 0, paddingVertical: 10, textAlign: 'center', borderColor: C.teal, color: C.teal}]} placeholder="Stock" value={String(e.stock || '')} onChangeText={t => updateMenuArr('entradas', idx, 'stock', t)} keyboardType="number-pad" />
                             </View>
                             <Touchable onPress={() => delMenuRow('entradas', idx)} style={{justifyContent: 'center', paddingHorizontal: 4}} accessibilityLabel="Eliminar entrada" accessibilityRole="button"><Feather name="trash-2" size={22} color={C.danger}/></Touchable>
                           </View>
                           
                           <Text style={{fontSize: 12, fontWeight: '800', color: C.textMuted, marginTop: 8, marginBottom: 4}}>ENVASES (LLEVAR/DELIVERY)</Text>
                           <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
                             {['chico', 'sopa', 'mediano', 'grande'].map(t => {
                                const tapersAct = Array.isArray(e.taper) ? e.taper : (e.taper ? [e.taper] : []);
                                const activo = tapersAct.includes(t);
                                return (
                                   <Touchable key={t} onPress={() => toggleTaperMenu('entradas', idx, t)} style={{backgroundColor: activo ? C.gold : C.bg, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: activo ? C.gold : C.border}}>
                                      <Text style={{fontSize: 12, fontWeight: 'bold', color: activo ? C.primary : C.textMuted}}>{t.toUpperCase()}</Text>
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
                    {/* 🟢 BOTONES RÁPIDOS DE PLATOS DEFAULT PARA DOMINGO */}
                    {admin.menuData.modoDomingo && (
                      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12, backgroundColor: '#FEF3C7', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#F59E0B'}}>
                        <View style={{width: '100%', marginBottom: 4}}>
                          <Text style={{fontSize: 12, fontWeight: '800', color: '#92400E', textTransform: 'uppercase'}}>
                            <Feather name="zap" size={12} color="#92400E" /> Añadir rápido:
                          </Text>
                        </View>
                        {PLATOS_DEFAULT_DOMINGO.map((plato: any, i: number) => {
                          const yaAgregado = (admin.menuData.segundos || []).some((s: any) => s.nombre === plato.nombre);
                          return (
                            <Touchable
                              key={i}
                              disabled={yaAgregado}
                              onPress={() => addDefaultDomingoPlato(plato.nombre)}
                              style={{
                                paddingVertical: 4,
                                paddingHorizontal: 10,
                                backgroundColor: yaAgregado ? '#D1D5DB' : '#F59E0B',
                                borderRadius: 6,
                                opacity: yaAgregado ? 0.6 : 1
                              }}
                            >
                              <Text style={{fontSize: 12, fontWeight: '800', color: yaAgregado ? '#4B5563' : '#120B06'}}>
                                {yaAgregado ? '✓ ' : '+ '}{plato.nombre}
                              </Text>
                            </Touchable>
                          );
                        })}
                      </View>
                    )}
                    <View style={{flexDirection: 'row', gap: 8, marginBottom: 16, backgroundColor: C.dangerSoft, padding: 8, borderRadius: 8, alignItems: 'center'}}>
                       <TextInput style={[s.modalInputCompact, {flex: 1, marginBottom: 0, paddingVertical: 6, backgroundColor: C.surface}]} placeholder="Guarnición general" value={admin.guarnicionGlobal} onChangeText={t => setAdmin(prev => ({ ...prev, guarnicionGlobal: t }))} />
                       <Touchable style={{backgroundColor: C.danger, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, justifyContent: 'center'}} onPress={aplicarGuarnicionGlobal}><Text style={{color: C.surface, fontWeight: '800', fontSize: 11}}>APLICAR A TODOS</Text></Touchable>
                    </View>
                    {(admin.menuData.segundos||[]).map((sItem: any, idx: number) => (
                      <View key={sItem.id || `seg-${idx}`} style={{backgroundColor: C.bg, padding: 12, borderRadius: 8, marginBottom: 12}}>
                          <View style={{flexDirection: 'row', gap: 8}}>
                            <View style={{flex: 1, gap: 8}}>
                              <TextInput style={[s.modalInputCompact, {marginBottom: 0, paddingVertical: 10}]} placeholder="Nombre de Fondo" value={sItem.nombre} onChangeText={t => updateMenuArr('segundos', idx, 'nombre', t)} />
                              <TextInput style={[s.modalInputCompact, {marginBottom: 0, fontSize: 13, paddingVertical: 8}]} placeholder="Acompañamiento (Opcional)" value={sItem.acomp||''} onChangeText={t => updateMenuArr('segundos', idx, 'acomp', t)} />
                            </View>
                            <View style={{justifyContent: 'space-between', alignItems: 'center', gap: 8}}>
                              <View style={{alignItems: 'center'}}>
                                <Text style={{fontSize: 12, color: C.danger, fontWeight: 'bold', marginBottom: 2}}>PRECIO S/</Text>
                                <TextInput style={[s.modalInputCompact, {width: 75, marginBottom: 0, textAlign: 'center', color: C.danger, fontWeight: '800'}]} placeholder="S/" value={String(sItem.precio)} onChangeText={t => updateMenuArr('segundos', idx, 'precio', t)} keyboardType="decimal-pad" />
                              </View>
                              <View style={{alignItems: 'center'}}>
                                <Text style={{fontSize: 12, color: C.teal, fontWeight: 'bold', marginBottom: 2}}>📦 STOCK</Text>
                                <TextInput style={[s.modalInputCompact, {width: 75, marginBottom: 0, textAlign: 'center', borderColor: C.teal, color: C.teal, fontWeight: '800'}]} placeholder="Stock" value={String(sItem.stock || '')} onChangeText={t => updateMenuArr('segundos', idx, 'stock', t)} keyboardType="number-pad" />
                              </View>
                              <Touchable onPress={() => delMenuRow('segundos', idx)} style={{padding: 8}} accessibilityLabel="Eliminar segundo" accessibilityRole="button"><Feather name="trash-2" size={22} color={C.danger}/></Touchable>
                            </View>
                          </View>
                          
                          <Text style={{fontSize: 12, fontWeight: '800', color: C.textMuted, marginTop: 8, marginBottom: 4}}>ENVASES (LLEVAR/DELIVERY)</Text>
                           <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
                             {['chico', 'sopa', 'mediano', 'grande'].map(t => {
                                const tapersAct = Array.isArray(sItem.taper) ? sItem.taper : (sItem.taper ? [sItem.taper] : []);
                                const activo = tapersAct.includes(t);
                                return (
                                   <Touchable key={t} onPress={() => toggleTaperMenu('segundos', idx, t)} style={{backgroundColor: activo ? C.danger : C.surface, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: activo ? C.danger : C.border}}>
                                      <Text style={{fontSize: 12, fontWeight: 'bold', color: activo ? C.surface : C.textMuted}}>{t.toUpperCase()}</Text>
                                   </Touchable>
                                );
                             })}
                           </View>
                      </View>
                    ))}
                 </View>

                 <Text style={s.seccionTitle}>BEBIDA INCLUIDA</Text>
                 <TextInput 
                    style={[s.modalInputCompact, { minHeight: 80, textAlignVertical: 'top' }]} 
                    placeholder="Ej: Chicha Morada..." 
                    value={admin.menuData.refresco || ''} 
                    onChangeText={t => updateAdminMenu({refresco: t})} 
                    multiline 
                  />
                 <Touchable style={[s.btnPrimary, {marginTop: 20, marginBottom: 40}]} onPress={guardarAdminMenu}><Text style={s.btnPrimaryText}>Publicar Menú en Caja</Text></Touchable>
              </ScrollView>
            </SafeAreaView>
          </Modal>

          {/* 🆕 Modal Contacto */}
          <Modal visible={admin.modalContacto} animationType="fade" transparent>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
              <View style={s.modalCard}>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20}}>
                  <Text style={s.modalTitle}>Contacto</Text>
                  <Touchable onPress={() => setAdmin(prev => ({ ...prev, modalContacto: false }))} style={{padding: 8}} accessibilityLabel="Cerrar contacto" accessibilityRole="button">
                    <Feather name="x" size={24} color={C.textMuted} />
                  </Touchable>
                </View>
                <Text style={{fontSize: 11, fontWeight: '800', color: C.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5}}>WhatsApp</Text>
                <TextInput style={s.modalInputCompact} placeholder="Número (Ej: 51999000000)" placeholderTextColor={C.textMuted} value={admin.contactoData.whatsapp} onChangeText={t => setAdmin(prev => ({...prev, contactoData: {...prev.contactoData, whatsapp: t}}))} keyboardType="phone-pad" />
                
                <Text style={{fontSize: 11, fontWeight: '800', color: C.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5}}>Facebook</Text>
                <TextInput style={s.modalInputCompact} placeholder="Link de Facebook" placeholderTextColor={C.textMuted} value={admin.contactoData.facebook} onChangeText={t => setAdmin(prev => ({...prev, contactoData: {...prev.contactoData, facebook: t}}))} />
                
                <Text style={{fontSize: 11, fontWeight: '800', color: C.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5}}>Instagram</Text>
                <TextInput style={[s.modalInputCompact, {marginBottom: 24}]} placeholder="Link de Instagram" placeholderTextColor={C.textMuted} value={admin.contactoData.instagram} onChangeText={t => setAdmin(prev => ({...prev, contactoData: {...prev.contactoData, instagram: t}}))} />
                
                <Touchable style={[s.btnPrimary, {backgroundColor: C.teal}]} onPress={guardarContacto}>
                  <Feather name="save" size={20} color={C.white} style={{marginRight: 8}} />
                  <Text style={s.btnPrimaryText}>Guardar Contacto</Text>
                </Touchable>
              </View>
            </KeyboardAvoidingView>
          </Modal>

          {/* 🎫 Modal Socios del Club (canje de premios) — solo Dueño */}
          <Modal visible={clubAdmin.modal} transparent animationType="fade" onRequestClose={clubAdmin.cerrarSocios}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
              <View style={[s.modalCard, { width: '94%', maxWidth: 620, maxHeight: '88%', padding: 20 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <Text style={[s.modalTitle, { marginBottom: 0 }]}>🎫 Socios del Club</Text>
                  <Touchable onPress={clubAdmin.cerrarSocios} style={{ padding: 8 }} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityLabel="Cerrar socios" accessibilityRole="button">
                    <Feather name="x" size={24} color={C.textMuted} />
                  </Touchable>
                </View>

                {/* Toggle SOCIOS / CANJES / CONFIG */}
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                  <Touchable
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: clubAdmin.vistaLista === 'socios' ? C.primary : C.bg, borderWidth: 1, borderColor: clubAdmin.vistaLista === 'socios' ? C.primary : C.border }}
                    onPress={() => clubAdmin.setVistaLista('socios')}
                  >
                    <Text style={{ color: clubAdmin.vistaLista === 'socios' ? C.surface : C.textMuted, fontWeight: '800', fontSize: 12 }}>👥 SOCIOS</Text>
                  </Touchable>
                  <Touchable
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: clubAdmin.vistaLista === 'canjes' ? C.gold : C.bg, borderWidth: 1, borderColor: clubAdmin.vistaLista === 'canjes' ? C.gold : C.border }}
                    onPress={() => clubAdmin.setVistaLista('canjes')}
                  >
                    <Text style={{ color: clubAdmin.vistaLista === 'canjes' ? C.primary : C.textMuted, fontWeight: '800', fontSize: 12 }}>🏆 CANJES</Text>
                  </Touchable>
                  <Touchable
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: clubAdmin.vistaLista === 'reportes' ? C.primary : C.bg, borderWidth: 1, borderColor: clubAdmin.vistaLista === 'reportes' ? C.teal : C.border }}
                    onPress={() => clubAdmin.setVistaLista('reportes')}
                  >
                    <Text style={{ color: clubAdmin.vistaLista === 'reportes' ? C.surface : C.textMuted, fontWeight: '800', fontSize: 12 }}>📊 REPORTES</Text>
                  </Touchable>
                </View>

                {clubAdmin.vistaLista === 'socios' && (
                  <>
                    <Text style={[s.modalSubtitle, { marginBottom: 14, fontSize: 12 }]}>
                  {clubAdmin.listosParaPremio > 0
                    ? `${clubAdmin.listosParaPremio} socio${clubAdmin.listosParaPremio > 1 ? 's' : ''} listo${clubAdmin.listosParaPremio > 1 ? 's' : ''} para su premio 🏆 · Meta: ${clubAdmin.meta} visitas`
                    : `Meta: ${clubAdmin.meta} visitas para el premio · Total: ${clubAdmin.miembros.length} socio${clubAdmin.miembros.length === 1 ? '' : 's'}`}
                </Text>

                <View style={[s.searchWrap, { marginBottom: 12 }]}>
                  <Feather name="search" size={18} color={C.textMuted} style={s.searchIcon} />
                  <TextInput
                    style={s.searchInput}
                    placeholder="Buscar por nombre o documento..."
                    placeholderTextColor={C.textMuted}
                    value={clubAdmin.busqueda}
                    onChangeText={clubAdmin.setBusqueda}
                  />
                  {clubAdmin.busqueda.length > 0 && (
                    <Touchable onPress={() => clubAdmin.setBusqueda('')} style={s.searchClear} accessibilityLabel="Limpiar búsqueda" accessibilityRole="button">
                      <Feather name="x-circle" size={18} color={C.textMuted} />
                    </Touchable>
                  )}
                </View>

                <Touchable
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, marginBottom: 14, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg }}
                  onPress={clubAdmin.cargarSocios}
                >
                  <Feather name="refresh-cw" size={14} color={C.textMuted} />
                  <Text style={{ color: C.textMuted, fontWeight: '700', fontSize: 12 }}>{clubAdmin.cargando ? 'Cargando…' : 'Actualizar lista'}</Text>
                </Touchable>

                {/* 🎫 Registrar socio nuevo: el backend valida el DNI contra RENIEC */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <TextInput
                    style={[s.searchInput, { flex: 1, marginBottom: 0 }]}
                    placeholder="DNI nuevo socio (RENIEC)"
                    placeholderTextColor={C.textMuted}
                    keyboardType="number-pad"
                    maxLength={8}
                    value={clubAdmin.nuevoDni}
                    onChangeText={clubAdmin.setNuevoDni}
                  />
                  <Touchable
                    disabled={clubAdmin.registrando}
                    onPress={clubAdmin.registrarSocio}
                    style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: C.successLight, alignItems: 'center' }}
                  >
                    <Text style={{ color: '#064E3B', fontWeight: '900', fontSize: 12, letterSpacing: 0.5 }}>
                      {clubAdmin.registrando ? '…' : '＋ SOCIO'}
                    </Text>
                  </Touchable>
                </View>

                {clubAdmin.cargando && clubAdmin.miembros.length === 0 ? (
                  <Text style={{ textAlign: 'center', color: C.textMuted, padding: 30, fontSize: 14 }}>Cargando socios…</Text>
                ) : clubAdmin.error !== '' && clubAdmin.miembros.length === 0 ? (
                  <View style={{ backgroundColor: C.dangerSoft, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.danger, marginTop: 4 }}>
                    <Text style={{ color: C.danger, textAlign: 'center', fontWeight: '800', fontSize: 13 }}>⚠️ {clubAdmin.error}</Text>
                    <Text style={{ color: C.danger, textAlign: 'center', fontSize: 12, marginTop: 6 }}>
                      Si es la primera vez, publica las reglas de Firestore para poder ver la lista.
                    </Text>
                  </View>
                ) : clubAdmin.listaFiltrada.length === 0 ? (
                  <Text style={{ textAlign: 'center', color: C.textMuted, padding: 30, fontSize: 14 }}>
                    {clubAdmin.miembros.length === 0
                      ? 'Aún no hay socios registrados. Los clientes crean su tarjeta gratis en la web del club.'
                      : 'Sin resultados para tu búsqueda.'}
                  </Text>
                ) : (
                  <>
                    {clubAdmin.error !== '' && (
                      <View style={{ backgroundColor: C.dangerSoft, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: C.danger, marginBottom: 12 }}>
                        <Text style={{ color: C.danger, textAlign: 'center', fontWeight: '700', fontSize: 12 }}>⚠️ {clubAdmin.error}</Text>
                      </View>
                    )}
                  <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ gap: 10 }}>
                    {clubAdmin.listaFiltrada.map((socio: any, i: number) => {
                      const prog = clubAdmin.progresoDe(socio);
                      const listo = prog.completado;
                      return (
                        <View
                          key={socio.id || `socio-${i}`}
                          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: listo ? C.goldSoft : C.bg, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: listo ? C.gold : C.border }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 14, fontWeight: '800', color: C.textDark }} numberOfLines={1}>{socio.nombre}</Text>
                            <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{socio.tipo_documento} {enmascararDocumento(socio.documento)}</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                              <View style={{ flex: 1, height: 8, borderRadius: 99, backgroundColor: C.border, overflow: 'hidden' }}>
                                <View style={{ height: '100%', width: `${prog.porcentaje}%`, backgroundColor: listo ? C.gold : C.success }} />
                              </View>
                              <Text style={{ fontSize: 12, fontWeight: '800', color: listo ? C.goldText : C.textDark }}>{prog.visitas}/{prog.meta}</Text>
                            </View>
                          </View>
                          <Touchable
                            disabled={!listo || clubAdmin.canjeando === socio.id}
                            onPress={() => clubAdmin.canjearPremio(socio)}
                            style={{ marginLeft: 12, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: listo ? C.successLight : C.border, alignItems: 'center' }}
                          >
                            <Text style={{ color: listo ? '#064E3B' : C.textMuted, fontWeight: '900', fontSize: 12, letterSpacing: 0.5 }}>
                              {clubAdmin.canjeando === socio.id ? 'CANJEANDO…' : listo ? '🏆 CANJEAR PREMIO' : 'EN PROGRESO'}
                            </Text>
                          </Touchable>
                        </View>
                      );
                    })}
                  </ScrollView>
                  </>
                )}
                  </>
                )}

                {clubAdmin.vistaLista === 'reportes' && (
                  <>
                    <Text style={[s.modalSubtitle, { marginBottom: 14, fontSize: 12 }]}>
                      📊 Estadísticas del Club · El crecimiento de la fidelización
                    </Text>

                    <Touchable
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, marginBottom: 14, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg }}
                      onPress={clubAdmin.cargarEstadisticas}
                    >
                      <Feather name="refresh-cw" size={14} color={C.textMuted} />
                      <Text style={{ color: C.textMuted, fontWeight: '700', fontSize: 12 }}>{clubAdmin.cargandoStats ? 'Cargando…' : 'Actualizar reportes'}</Text>
                    </Touchable>

                    {clubAdmin.cargandoStats && !clubAdmin.stats ? (
                      <Text style={{ textAlign: 'center', color: C.textMuted, padding: 30, fontSize: 14 }}>Calculando reportes…</Text>
                    ) : !clubAdmin.stats ? (
                      <Text style={{ textAlign: 'center', color: C.textMuted, padding: 30, fontSize: 14 }}>
                        No se pudieron cargar los reportes. Verifica la conexión con la caja (IP).
                      </Text>
                    ) : (
                      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 12 }}>
                        {/* KPI cards */}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {([
                            { label: 'SOCIOS', valor: clubAdmin.stats.total_socios, icon: 'users', color: C.primary },
                            { label: 'LISTOS 🏆', valor: clubAdmin.stats.listos_premio, icon: 'award', color: C.gold },
                            { label: '% PREMIO', valor: `${clubAdmin.stats.pct_premio}%`, icon: 'percent', color: C.success },
                            { label: 'PREMIOS', valor: clubAdmin.stats.total_premios, icon: 'gift', color: C.teal },
                            { label: 'VISITAS', valor: clubAdmin.stats.total_visitas, icon: 'trending-up', color: C.danger },
                          ] as const).map((kpi) => (
                            <View key={kpi.label} style={{ flexBasis: '46%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border }}>
                              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: kpi.color + '22', alignItems: 'center', justifyContent: 'center' }}>
                                <Feather name={kpi.icon} size={16} color={kpi.color} />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 16, fontWeight: '900', color: C.textDark, lineHeight: 18 }}>{kpi.valor}</Text>
                                <Text style={{ fontSize: 12, fontWeight: '800', color: C.textMuted, letterSpacing: 0.5 }}>{kpi.label}</Text>
                              </View>
                            </View>
                          ))}
                        </View>

                        {/* Socios nuevos por mes */}
                        <View style={{ backgroundColor: C.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border }}>
                          <Text style={{ fontSize: 12, fontWeight: '800', color: C.textDark, marginBottom: 10 }}>👥 Socios nuevos por mes</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 80 }}>
                            {(clubAdmin.stats.socios_nuevos_por_mes || []).map((m: any) => {
                              const max = Math.max(1, ...(clubAdmin.stats.socios_nuevos_por_mes || []).map((x: any) => x.socios || 0));
                              return (
                                <View key={m.mes} style={{ flex: 1, alignItems: 'center' }}>
                                  <Text style={{ fontSize: 12, fontWeight: '800', color: C.textDark }}>{m.socios || 0}</Text>
                                  <View style={{ width: '100%', maxWidth: 30, height: Math.max(4, ((m.socios || 0) / max) * 55), backgroundColor: C.gold, borderRadius: 5 }} />
                                  <Text style={{ fontSize: 10, color: C.textMuted, fontWeight: '700', marginTop: 3 }}>{m.mes.slice(2)}</Text>
                                </View>
                              );
                            })}
                          </View>
                        </View>

                        {/* Visitas por día */}
                        <View style={{ backgroundColor: C.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border }}>
                          <Text style={{ fontSize: 12, fontWeight: '800', color: C.textDark, marginBottom: 10 }}>👣 Visitas por día (14 días)</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 70 }}>
                            {(clubAdmin.stats.visitas_ultimos_14 || []).map((d: any) => {
                              const max = Math.max(1, ...(clubAdmin.stats.visitas_ultimos_14 || []).map((x: any) => x.visitas || 0));
                              return (
                                <View key={d.fecha} style={{ flex: 1, alignItems: 'center' }}>
                                  <View style={{ width: '100%', maxWidth: 14, height: Math.max(3, ((d.visitas || 0) / max) * 45), backgroundColor: C.teal, borderRadius: 3 }} />
                                  <Text style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>{d.fecha.slice(8)}</Text>
                                </View>
                              );
                            })}
                          </View>
                        </View>

                        {/* Premios por mes */}
                        <View style={{ backgroundColor: C.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border }}>
                          <Text style={{ fontSize: 12, fontWeight: '800', color: C.textDark, marginBottom: 10 }}>🏆 Premios entregados por mes</Text>
                          {(clubAdmin.stats.premios_por_mes || []).some((p: any) => p.premios > 0) ? (
                            (clubAdmin.stats.premios_por_mes || []).filter((p: any) => p.premios > 0).map((p: any) => {
                              const max = Math.max(1, ...(clubAdmin.stats.premios_por_mes || []).map((x: any) => x.premios || 0));
                              return (
                                <View key={p.mes} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                  <Text style={{ width: 64, fontSize: 12, fontWeight: '800', color: C.textDark }}>{p.mes}</Text>
                                  <View style={{ flex: 1, height: 10, backgroundColor: C.border, borderRadius: 99, overflow: 'hidden' }}>
                                    <View style={{ height: '100%', width: `${Math.min(100, ((p.premios || 0) / max) * 100)}%`, backgroundColor: C.success, borderRadius: 99 }} />
                                  </View>
                                  <Text style={{ width: 24, textAlign: 'right', fontSize: 12, fontWeight: '900', color: C.successDark }}>{p.premios}</Text>
                                </View>
                              );
                            })
                          ) : (
                            <Text style={{ textAlign: 'center', color: C.textMuted, fontSize: 12, paddingVertical: 8 }}>
                              Aún no hay premios entregados.
                            </Text>
                          )}
                        </View>
                      </ScrollView>
                    )}
                  </>
                )}

                {clubAdmin.vistaLista === 'canjes' && (
                  <>
                    <Text style={[s.modalSubtitle, { marginBottom: 14, fontSize: 12 }]}>
                      {clubAdmin.premios.length > 0
                        ? `${clubAdmin.premios.length} premio${clubAdmin.premios.length > 1 ? 's' : ''} canjeado${clubAdmin.premios.length > 1 ? 's' : ''} 🏆`
                        : 'Historial de premios canjeados'}
                    </Text>

                    <Touchable
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, marginBottom: 14, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg }}
                      onPress={clubAdmin.cargarPremios}
                    >
                      <Feather name="refresh-cw" size={14} color={C.textMuted} />
                      <Text style={{ color: C.textMuted, fontWeight: '700', fontSize: 12 }}>Actualizar historial</Text>
                    </Touchable>

                    {clubAdmin.premios.length === 0 ? (
                      <Text style={{ textAlign: 'center', color: C.textMuted, padding: 30, fontSize: 14 }}>
                        Aún no hay premios canjeados. Cuando canjees uno, aparecerá aquí.
                      </Text>
                    ) : (
                      <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ gap: 10 }}>
                        {clubAdmin.premios.map((p: any, i: number) => (
                          <View key={p.id || `premio-${i}`} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border }}>
                            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.goldSoft, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                              <Text style={{ fontSize: 18 }}>🏆</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 14, fontWeight: '800', color: C.textDark }} numberOfLines={1}>{p.nombre}</Text>
                              <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{enmascararDocumento(p.documento)} · {p.sede}</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text style={{ fontSize: 12, fontWeight: '800', color: C.goldText }}>{p.fecha_local}</Text>
                              {p.canjeado_por !== '' && <Text style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{p.canjeado_por}</Text>}
                            </View>
                          </View>
                        ))}
                      </ScrollView>
                    )}
                  </>
                )}


              </View>
            </KeyboardAvoidingView>
          </Modal>
        </>
      )}

      {/* ─── PANTALLA 4: COMANDERA TÁCTIL ─── */}
      {!sys.modoConfig && authData.usuarioActivo && authData.usuarioActivo.rol !== 'admin' && mozo.vistaActual === 'comandar' && mozo.mesaActiva && (
        <>
          <View style={s.navbar}>
            <Touchable style={s.navBackBtn} onPress={() => setMozo(prev => ({ ...prev, vistaActual: 'mesas' }))} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
              <Feather name="chevron-left" size={28} color={C.surface} />
              <Text style={s.navBackText}>Mesas</Text>
            </Touchable>
            <Text style={s.navTitle} numberOfLines={1}>{mozo.mesaActiva ? formatMesaName(mozo.mesaActiva.id) : ''}</Text>
            <View style={{ width: 80 }} />
          </View>

          <ScrollView style={s.scrollBase} contentContainerStyle={{ padding: PADDING, paddingBottom: carrito.length > 0 ? 320 : 40 }} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
            <View style={s.searchWrap}>
              <Feather name="search" size={20} color={C.textMuted} style={s.searchIcon} />
              <TextInput style={s.searchInput} placeholder="Buscar plato..." placeholderTextColor={C.textMuted} value={mozo.filtroCarta} onChangeText={t => setMozo(prev => ({ ...prev, filtroCarta: t }))} />
              {mozo.filtroCarta.length > 0 && <Touchable onPress={() => setMozo(prev => ({ ...prev, filtroCarta: '' }))} style={s.searchClear} accessibilityLabel="Limpiar búsqueda" accessibilityRole="button"><Feather name="x-circle" size={20} color={C.textMuted} /></Touchable>}
            </View>

            {mozo.filtroCarta === '' && (
              <>
                {(() => {
                  const extraStock = (appData as any).extrasStock || {};
                  const taperChicoAgotado = (extraStock['TAPER CHICO'] ?? 99) <= 0;
                  const taperMedianoAgotado = (extraStock['TAPER MEDIANO'] ?? 99) <= 0;
                  const humitaAgotado = (extraStock['HUMITA'] ?? 99) <= 0;
                  return (
                    <>
                      <View style={s.quickGrid}>
                        <Touchable style={[s.quickBtn, {borderColor: C.teal, backgroundColor: taperChicoAgotado ? C.border : '#EBF5F8', borderWidth: 2, opacity: taperChicoAgotado ? 0.5 : 1}]} disabled={taperChicoAgotado} onPress={() => agregarAlCarrito({ nombre: 'TAPER CHICO', precio: 1.0 }, 'GENERAL')}>
                          <MaterialCommunityIcons name="cube-outline" size={28} color={taperChicoAgotado ? C.textMuted : C.teal} style={{marginBottom: 4}} />
                          <Text style={[s.quickBtnLabel, {color: taperChicoAgotado ? C.textMuted : C.teal}]}>{taperChicoAgotado ? 'AGOTADO' : 'T. Chico'}</Text>
                          <Text style={[s.quickBtnPrice, taperChicoAgotado && {color: C.textMuted}]}>{taperChicoAgotado ? 'Sin stock' : 'S/ 1.00'}</Text>
                        </Touchable>
                        <Touchable style={[s.quickBtn, {borderColor: C.danger, backgroundColor: taperMedianoAgotado ? C.border : C.dangerSoft, borderWidth: 2, opacity: taperMedianoAgotado ? 0.5 : 1}]} disabled={taperMedianoAgotado} onPress={() => agregarAlCarrito({ nombre: 'TAPER MEDIANO', precio: 2.0 }, 'GENERAL')}>
                          <MaterialCommunityIcons name="cube" size={28} color={taperMedianoAgotado ? C.textMuted : C.danger} style={{marginBottom: 4}} />
                          <Text style={[s.quickBtnLabel, {color: taperMedianoAgotado ? C.textMuted : C.danger}]}>{taperMedianoAgotado ? 'AGOTADO' : 'T. Mediano'}</Text>
                          <Text style={[s.quickBtnPrice, {color: taperMedianoAgotado ? C.textMuted : C.danger}]}>{taperMedianoAgotado ? 'Sin stock' : 'S/ 2.00'}</Text>
                        </Touchable>
                      </View>
                      <View style={[s.quickGrid, { marginBottom: 16 }]}>
                        <Touchable style={[s.quickBtn, {backgroundColor: humitaAgotado ? C.border : '#F0FDF4', borderColor: '#22C55E', borderWidth: 2, opacity: humitaAgotado ? 0.5 : 1}]} disabled={humitaAgotado} onPress={() => agregarAlCarrito({ nombre: 'HUMITA', precio: 4.0 }, 'GENERAL')}>
                          <MaterialCommunityIcons name="corn" size={28} color={humitaAgotado ? C.textMuted : '#16A34A'} style={{marginBottom: 4}} />
                          <Text style={[s.quickBtnLabel, {color: humitaAgotado ? C.textMuted : '#16A34A'}]}>{humitaAgotado ? 'AGOTADO' : 'Humita'}</Text>
                          <Text style={[s.quickBtnPrice, humitaAgotado && {color: C.textMuted}]}>{humitaAgotado ? 'Sin stock' : 'S/ 4.00'}</Text>
                        </Touchable>
                        <Touchable style={[s.quickBtn, {backgroundColor: '#EBF5F8', borderColor: C.teal, borderWidth: 2}]} onPress={() => agregarAlCarrito({ nombre: 'REFRESCO', precio: appData.modoDomingo ? 3.5 : 2.0 }, 'BEBIDAS')}>
                          <MaterialCommunityIcons name="bottle-soda-outline" size={28} color={C.teal} style={{marginBottom: 4}} />
                          <Text style={[s.quickBtnLabel, {color: C.teal}]}>Refresco</Text>
                          <Text style={s.quickBtnPrice}>S/ {appData.modoDomingo ? '3.50' : '2.00'}</Text>
                        </Touchable>
                      </View>
                    </>
                  );
                })()}
                <Touchable style={[s.fueraCarta, {backgroundColor: '#FFF7ED', borderColor: '#F59E0B', borderWidth: 2}]} onPress={() => setUi(prev => ({ ...prev, modalFueraCarta: true }))}>
                  <Feather name="edit-3" size={18} color={'#D97706'} /><Text style={[s.fueraCartaText, {color: '#92400E', fontWeight: '800'}]}>Plato fuera de carta</Text>
                </Touchable>
              </>
            )}

            {mozo.mesaActiva.pedido?.length > 0 && mozo.filtroCarta === '' && (
              <View style={s.yaPedidoCard}>
                <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8}}>
                  <View style={{flexDirection: 'row', alignItems: 'center'}}>
                    <Feather name="list" size={16} color={C.primary} /><Text style={s.yaPedidoTitle}>Ya en esta mesa</Text>
                  </View>
                  {(() => {
                    const cambios = obtenerHistorialCambios(mozo.mesaActiva.pedido);
                    return cambios.length > 0 ? (
                      <Touchable
                        style={{flexDirection: 'row', alignItems: 'center', backgroundColor: C.danger, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, gap: 4}}
                        onPress={() => setUi(prev => ({ ...prev, modalHistorialCambios: true }))}
                      >
                        <Feather name="rotate-ccw" size={12} color={C.white} />
                        <Text style={{color: C.white, fontWeight: '800', fontSize: 12}}>{cambios.length} Cambio{cambios.length > 1 ? 's' : ''}</Text>
                      </Touchable>
                    ) : null;
                  })()}
                </View>
                {mozo.mesaActiva.pedido.map((p: any, i: number) => (
                  <View key={p.id || `pedido-${i}`} style={s.yaPedidoRow}>
                    <Text style={s.yaPedidoItem}>
                      <Text style={{ color: C.danger, fontWeight: '700' }}>{p.cantidad}×  </Text>
                      <Text style={{ color: C.textDark, fontWeight: '600' }}>{p.nombre}</Text>
                      {['entradas', 'segundos'].includes(p.categoria?.toLowerCase()) && <Text style={{ color: C.goldText, fontSize: 12, fontWeight: '800' }}> (MENÚ)</Text>}
                      {p.modalidad !== 'local' && <Text style={{ color: C.textMuted }}> · {p.modalidad}</Text>}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {appData.carta.filter((c: any) => ['entradas', 'segundos'].includes(c.nombre.toLowerCase().trim())).map((cat: any) => {
              if (appData.modoDomingo && cat.nombre.toLowerCase().trim() === 'entradas') return null;
              const items = cat.items.filter((p: any) => p.nombre.toLowerCase().includes(mozo.filtroCarta.toLowerCase()));
              if (items.length === 0) return null;
              const catConf = getCatConf(cat.nombre);
              return (
                <View key={cat.nombre} style={{ marginBottom: 10 }}>
                  <View style={s.catHeader}>
                    <View style={[s.catHeaderIcon, {backgroundColor: catConf.color}]}>
                      <MaterialCommunityIcons name={catConf.icon as any} size={16} color={C.white} />
                    </View>
                    <Text style={[s.catLabel, {marginBottom: 0, marginTop: 0}]}>{cat.nombre.toUpperCase()}</Text>
                  </View>
                  <View style={[s.platosGrid, { justifyContent: 'space-between' }]}>
                    {items.map((plato: any) => {
                      const cantEnCarrito = carrito.filter(i => i.nombre === plato.nombre && i.categoria === cat.nombre).reduce((acc, curr) => acc + curr.cantidad, 0);
                      const agotado = plato.stock_actual !== null && plato.stock_actual <= 0;
                      const pocoStock = plato.stock_actual !== null && plato.stock_actual <= 3 && plato.stock_actual > 0;
                      // 🟢 FIX RESPONSIVE: fuente dinámica para que el nombre del plato nunca se corte
                      const nombrePlato = plato.nombre || '';
                      const tamanoNombre = nombrePlato.length > 34 ? 11 : nombrePlato.length > 24 ? 12 : nombrePlato.length > 16 ? 12 : 13;

                      return (
                        <Touchable 
                           key={plato.id || plato.nombre} 
                           style={[
                             s.platoBtn, 
                             { width: PLATO_CARD_WIDTH, backgroundColor: catConf.tintBg },
                             agotado && { opacity: 0.5, backgroundColor: C.border }
                           ]} 
                           disabled={agotado}
                           onPress={() => agregarAlCarrito(plato, cat.nombre)}
                        >
                          <>
                            {pocoStock && (
                              <View style={s.stockBadge}>
                                <Feather name="alert-triangle" size={10} color={C.white} />
                                <Text style={s.stockBadgeText}>¡{plato.stock_actual}!</Text>
                              </View>
                            )}
                            {cantEnCarrito > 0 && (
                              <View style={s.badgeComanda}>
                                <Text style={s.badgeComandaText}>{cantEnCarrito}</Text>
                              </View>
                            )}
                          </>
                          <View style={[s.platoBtnBar, { backgroundColor: agotado ? C.textMuted : catConf.color }]} />
                          <Text
                            style={[
                              s.platoNombre,
                              { fontSize: tamanoNombre, lineHeight: tamanoNombre + 4 },
                              agotado && { textDecorationLine: 'line-through', color: C.textMuted }
                            ]}
                            numberOfLines={3}
                          >{nombrePlato}</Text>
                          <Text style={[s.platoPrecio, { color: agotado ? C.textMuted : catConf.color }]}>
                            {agotado ? 'AGOTADO' : `S/ ${plato.precio.toFixed(2)}`}
                          </Text>
                        </Touchable>
                      );
                    })}
                  </View>
                </View>
              );
            })}

            {appData.carta.filter((c: any) => c.nombre !== 'entradas' && c.nombre !== 'segundos').map((cat: any) => {
              const items = cat.items.filter((p: any) => p.nombre.toLowerCase().includes(mozo.filtroCarta.toLowerCase()));
              if (items.length === 0) return null;
              const catConf = getCatConf(cat.nombre);
              return (
                <View key={cat.nombre} style={s.seccionWrap}>
                  <View style={s.seccionHeader}>
                    <View style={[s.catHeaderIcon, {backgroundColor: catConf.color}]}>
                      <MaterialCommunityIcons name={catConf.icon as any} size={16} color={C.white} />
                    </View>
                    <Text style={s.seccionHeaderTitle}>{cat.nombre}</Text>
                    <View style={[s.seccionHeaderLine, {backgroundColor: catConf.color}]} />
                  </View>
                  <View style={[s.platosGrid, { justifyContent: 'space-between' }]}>
                    {items.map((plato: any) => {
                      const cantEnCarrito = carrito.filter(i => i.nombre === plato.nombre && i.categoria === cat.nombre).reduce((acc, curr) => acc + curr.cantidad, 0);
                      const agotado = plato.stock_actual !== null && plato.stock_actual <= 0;
                      const pocoStock = plato.stock_actual !== null && plato.stock_actual <= 3 && plato.stock_actual > 0;
                      // 🟢 FIX RESPONSIVE: fuente dinámica para que el nombre del plato nunca se corte
                      const nombrePlato = plato.nombre || '';
                      const tamanoNombre = nombrePlato.length > 34 ? 11 : nombrePlato.length > 24 ? 12 : nombrePlato.length > 16 ? 12 : 13;
                      return (
                        <Touchable key={plato.id || plato.nombre} style={[s.platoBtn, { width: PLATO_CARD_WIDTH, backgroundColor: catConf.tintBg }, agotado && { opacity: 0.5, backgroundColor: C.border }]} disabled={agotado} onPress={() => agregarAlCarrito(plato, cat.nombre)}>
                          <>
                            {pocoStock && (
                              <View style={s.stockBadge}>
                                <Feather name="alert-triangle" size={10} color={C.white} />
                                <Text style={s.stockBadgeText}>¡{plato.stock_actual}!</Text>
                              </View>
                            )}
                            {cantEnCarrito > 0 && (
                              <View style={s.badgeComanda}>
                                <Text style={s.badgeComandaText}>{cantEnCarrito}</Text>
                              </View>
                            )}
                          </>
                          <View style={[s.platoBtnBar, { backgroundColor: agotado ? C.textMuted : catConf.color }]} />
                          <Text
                            style={[s.platoNombre, { fontSize: tamanoNombre, lineHeight: tamanoNombre + 4 }, agotado && { textDecorationLine: 'line-through', color: C.textMuted }]}
                            numberOfLines={3}
                          >{nombrePlato}</Text>
                          <Text style={[s.platoPrecio, { color: agotado ? C.textMuted : catConf.color }]}>
                            {agotado ? 'AGOTADO' : `S/ ${plato.precio.toFixed(2)}`}
                          </Text>
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
                            <Text style={s.carritoItemNombre} numberOfLines={2}>
                               <Text style={{ color: C.primary, fontWeight: '800' }}>{item.cantidad}×  </Text>
                               {item.nombre}
                               {['entradas', 'segundos'].includes(item.categoria?.toLowerCase()) && <Text style={{color: C.goldText, fontSize: 12}}> (MENÚ)</Text>}
                            </Text>
                            {item.modalidad !== 'local' && item.taper && <Text style={{fontSize: 11, color: C.textMuted, marginTop: 2, fontWeight: 'bold'}}>+ Envase {Array.isArray(item.taper) ? item.taper.join(' y ') : item.taper}</Text>}
                            {item.cliente && <Text style={s.carritoItemNota}><Feather name="map-pin" size={12}/> Delivery a: {item.cliente.nombre}</Text>}
                            {item.nota ? <Text style={s.carritoItemNota}><Feather name="alert-circle" size={12}/> {item.nota}</Text> : null}
                          </View>
                          <Text style={s.carritoItemPrecio}>S/ {((item.precio + calcularRecargoTaperMozo(item)) * item.cantidad).toFixed(2)}</Text>
                        </View>
                        <View style={s.carritoItemRow2}>
                          <Touchable style={[s.modBtn, !esLocal && s.modBtnActiva]} onPress={() => ciclarModalidad(idx)}>
                            <ModIcon mod={item.modalidad} color={esLocal ? C.textMuted : C.white} />
                            <Text style={[s.modBtnText, !esLocal && s.modBtnTextActiva]}>{modLabelText(item.modalidad)}</Text>
                            <Feather name="refresh-cw" size={12} color={esLocal ? C.textMuted : C.white} style={{marginLeft: 4}}/>
                          </Touchable>
                          <View style={[s.carritoControles, { gap: isTablet ? 12 : 8 }]}>
                            <Touchable style={[s.notaBtn, { width: isTablet ? 48 : 40, height: isTablet ? 48 : 40 }]} onPress={() => { setUi(prev => ({ ...prev, itemEditando: idx, notaInput: carrito[idx].nota || '', modalNota: true, notaCantidadMover: 1 })); }} accessibilityLabel={`Nota para ${item.nombre}`} accessibilityRole="button"><Feather name="file-text" size={18} color={C.textMuted} /></Touchable>
                            <View style={s.qtyControls}>
                              <Touchable style={[s.qtyBtn, { width: isTablet ? 48 : 40, height: isTablet ? 48 : 40 }]} onPress={() => modificarCantidad(idx, -1)} accessibilityLabel={`Disminuir cantidad de ${item.nombre}`} accessibilityRole="button"><Feather name="minus" size={20} color={C.textDark} /></Touchable>
                              <Text style={s.qtyNumber}>{item.cantidad}</Text>
                              <Touchable style={[s.qtyBtn, { width: isTablet ? 48 : 40, height: isTablet ? 48 : 40 }]} onPress={() => modificarCantidad(idx, 1)} accessibilityLabel={`Aumentar cantidad de ${item.nombre}`} accessibilityRole="button"><Feather name="plus" size={20} color={C.textDark} /></Touchable>
                            </View>
                            <Touchable style={[s.eliminarBtn, { width: isTablet ? 48 : 40, height: isTablet ? 48 : 40 }]} onPress={() => {
                              modificarCantidad(idx, -item.cantidad);
                              if(carrito.length === 1) setCartVisible(false);
                            }} accessibilityLabel={`Eliminar ${item.nombre}`} accessibilityRole="button"><Feather name="trash-2" size={18} color={C.danger} /></Touchable>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>                    <View style={[s.carritoFooter, { paddingBottom: 16 + insets.bottom }]}>
                  <Touchable style={[s.btnPrimary, {backgroundColor: C.primary, borderRadius: 16, padding: 20, elevation: 6, boxShadow: '0px 3px 6px rgba(0, 0, 0, 0.15)'}]} onPress={() => { setCartVisible(false); enviarComanda(); }}>
                    <MaterialCommunityIcons name="send" size={22} color={C.white} style={{marginRight: 10}} />
                    <Text style={[s.btnPrimaryText, {fontSize: 17}]}>Enviar a Cocina</Text>
                    <View style={{backgroundColor: C.gold, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4, marginLeft: 12}}>
                      <Text style={{color: C.primary, fontWeight: '800', fontSize: 14}}>{totalItems}</Text>
                    </View>
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
                    accessibilityLabel="Disminuir cantidad" accessibilityRole="button"
                  >
                    <Feather name="minus" size={24} color={C.textDark} />
                  </Touchable>
                  
                  <Text style={{ fontSize: 40, fontWeight: '800', color: C.textDark, minWidth: 50, textAlign: 'center' }}>
                    {uiSplit.cantidadMover}
                  </Text>
                  
                  <Touchable 
                    style={[s.qtyBtn, {backgroundColor: C.bg, width: 50, height: 50, borderRadius: 25}]} 
                    onPress={() => setUiSplit(p => ({...p, cantidadMover: Math.min(p.cantidadTotal, p.cantidadMover + 1)}))}
                    accessibilityLabel="Aumentar cantidad" accessibilityRole="button"
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
            <KeyboardAvoidingView behavior="padding" style={s.modalOverlay}>
              <View style={s.modalCard}>
                <Text style={s.modalTitle}>Nota para cocina</Text>
                <Text style={s.modalSubtitle}>Ej: sin cebolla, poca sal</Text>
                <TextInput style={s.modalInput} placeholder="Escribe la nota..." placeholderTextColor={C.textMuted} value={ui.notaInput} onChangeText={t => setUi(prev => ({ ...prev, notaInput: t }))} multiline />
                
                {ui.itemEditando !== null && carrito[ui.itemEditando]?.cantidad > 1 && (
                  <View style={{ alignItems: 'center', marginBottom: 20 }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: C.textMuted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.3 }}>¿A cuántos platos aplicar nota?</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
                      <Touchable style={[s.qtyBtn, {backgroundColor: C.bg, width: 44, height: 44, borderRadius: 22}]} onPress={() => setUi(prev => ({ ...prev, notaCantidadMover: Math.max(1, prev.notaCantidadMover - 1) }))} accessibilityLabel="Menos platos con nota" accessibilityRole="button">
                        <Feather name="minus" size={20} color={C.textDark} />
                      </Touchable>
                      <Text style={{ fontSize: 26, fontWeight: '800', color: C.textDark, minWidth: 40, textAlign: 'center' }}>{ui.notaCantidadMover}</Text>
                      <Touchable style={[s.qtyBtn, {backgroundColor: C.bg, width: 44, height: 44, borderRadius: 22}]} onPress={() => setUi(prev => ({ ...prev, notaCantidadMover: Math.min(ui.itemEditando != null ? carrito[ui.itemEditando].cantidad : 0, prev.notaCantidadMover + 1) }))} accessibilityLabel="Más platos con nota" accessibilityRole="button">
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
                <TextInput style={s.modalInputCompact} placeholder="Nombre / Dirección" placeholderTextColor={C.textMuted} value={ui.datosDelivery.nombre} onChangeText={t => setUi(prev => ({ ...prev, datosDelivery: { ...prev.datosDelivery, nombre: t } }))} />
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
              <View style={[s.statusPill, { backgroundColor: sys.conectado ? 'rgba(16, 185, 129, 0.08)' : 'rgba(215, 38, 61, 0.08)', borderColor: sys.conectado ? 'rgba(16, 185, 129, 0.3)' : 'rgba(215, 38, 61, 0.3)' }]}>
                <View style={[s.statusDot, { backgroundColor: sys.conectado ? C.success : C.danger }]} />
                <Text style={s.statusPillText} numberOfLines={1}>{sys.serverStatus}</Text>
              </View>
              <Touchable onPress={club.abrirClub} style={s.cfgIconBtn} accessibilityLabel="Club Calletano" accessibilityRole="button"><Feather name="credit-card" size={20} color={C.surface} /></Touchable>
              <Touchable onPress={cerrarSesion} style={s.cfgIconBtn} accessibilityLabel="Cerrar sesión" accessibilityRole="button"><Feather name="log-out" size={20} color={C.surface} /></Touchable>
            </View>
          </View>

          <ScrollView style={s.scrollBase} contentContainerStyle={{ padding: PADDING, paddingBottom: 32 }} contentInsetAdjustmentBehavior="automatic">
            {elRestauranteEstaCerrado ? (
               <View style={{backgroundColor: C.dangerSoft, padding: 30, borderRadius: 16, alignItems: 'center', marginTop: 20, borderWidth: 1, borderColor: C.danger}}>
                  <Feather name="lock" size={40} color={C.danger} style={{marginBottom: 10}} />
                  <Text style={{color: C.danger, fontSize: 18, fontWeight: '800', textAlign: 'center'}}>RESTAURANTE CERRADO</Text>                    <Text style={{color: C.danger, textAlign: 'center', marginTop: 10, fontWeight: '600'}}>El administrador ha cerrado el sistema de comandas por hoy.</Text>
               </View>
            ) : (
              <>
                <Text style={s.mesasSectionLabel}>SALÓN - Selecciona una mesa</Text>
                <View style={[s.mesasGrid, { justifyContent: 'space-between' }]}>
                  {mesasSnakeOrder.map((mesa: any) => {
                    const ocupada = mesa.estado === 'ocupada';
                    const totalMesa = mesa.total ?? 0;
                    const cantItems = mesa.pedido?.length ?? 0;
                    // 🟢 FIX RESPONSIVE: fuentes dinámicas para que nombre, cantidad y total nunca se corten
                    const nombreMesa = formatMesaName(mesa.id);
                    const tamanoNombre = nombreMesa.length > 14 ? 12 : nombreMesa.length > 9 ? 14 : 17;
                    const textoTotal = `S/ ${totalMesa.toFixed(2)}`;
                    const tamanoTotal = textoTotal.length > 10 ? 11 : 12;
                    return (
                      <Touchable key={mesa.id} style={[s.mesaCard, { width: CARD_WIDTH }, ocupada && s.mesaCardOcupada]} onPress={() => abrirMesa(mesa)}>
                        <View style={[s.mesaCardBar, { backgroundColor: ocupada ? C.danger : C.gold }]} />
                        <View style={{alignItems: 'center', marginTop: 16, marginBottom: 4}}>
                          <MaterialCommunityIcons name={ocupada ? 'seat' : 'seat-outline'} size={28} color={ocupada ? C.danger : C.gold} />
                        </View>
                        <Text
                          style={[s.mesaCardNombre, { marginTop: 4, marginBottom: 8, color: ocupada ? C.textDark : C.goldText, fontSize: tamanoNombre, lineHeight: tamanoNombre + 3 }]}
                        >{nombreMesa}</Text>
                        <View style={[s.mesaCardBadge, { backgroundColor: ocupada ? C.dangerSoft : C.goldSoft, borderColor: ocupada ? C.danger : C.gold }]}>
                          <Text style={[s.mesaCardBadgeText, { color: ocupada ? C.danger : C.goldText }]}>{ocupada ? 'Ocupada' : 'Libre'}</Text>
                        </View>
                        <View style={[s.mesaCardFooter, cantItems === 0 && { borderTopWidth: 0 }]}>
                          {cantItems > 0 ? (
                            <>
                              <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, flexShrink: 1, minWidth: 0}}>
                                <MaterialCommunityIcons name="silverware" size={13} color={C.textMuted} />
                                <Text style={s.mesaCardItems} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{cantItems} plato{cantItems !== 1 ? 's' : ''}</Text>
                              </View>
                              <Text style={[s.mesaCardTotal, { fontSize: tamanoTotal, lineHeight: tamanoTotal + 3 }, totalMesa > 0 && s.mesaCardTotalActivo]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{textoTotal}</Text>
                            </>
                          ) : (
                            <Text style={{color: C.textMuted, fontSize: 11, fontStyle: 'italic', flex: 1, textAlign: 'center'}}>Sin pedidos</Text>
                          )}
                        </View>
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

      {/* 🟢 MODAL: SELECCIÓN DE BEBIDA MODO DOMINGO MOZO - TOQUE INDIVIDUAL + QUITAR */}
      <Modal visible={ui.modalBebidaDomingo} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={[s.modalTitle, {textAlign: 'center'}]}>Asignar Bebidas</Text>
            {(() => {
              // 🐛 FIX: solo cuentan almuerzos REALES (es_modo_domingo + categoría segundos)
              const totalAlm = carrito
                .filter((i: any) => i.es_modo_domingo && ['segundos', 'segundo'].includes(String(i.categoria || '').toLowerCase().trim()))
                .reduce((sum: number, i: any) => sum + i.cantidad, 0);
              const totalBeb = carrito.filter((i: any) => i.isMenuDrink).reduce((sum: number, i: any) => sum + i.cantidad, 0);
              const pendientes = totalAlm - totalBeb;
              const bebidasAsignadas = carrito.filter(i => i.isMenuDrink).reduce((acc: any, i) => {
                const exist = acc.find((a: any) => a.nombre === i.nombre);
                if (exist) exist.cantidad += i.cantidad;
                else acc.push({ nombre: i.nombre, cantidad: i.cantidad });
                return acc;
              }, []);
              
              if (pendientes === 0 && bebidasAsignadas.length === 0) {
                return (
                  <>
                    <Text style={[s.modalSubtitle, {textAlign: 'center', marginBottom: 20}]}>
                      No hay almuerzos en el carrito.
                    </Text>
                    <Touchable style={s.btnSecondary} onPress={() => setUi(prev => ({ ...prev, modalBebidaDomingo: false }))}>
                      <Text style={s.btnSecondaryText}>Cerrar</Text>
                    </Touchable>
                  </>
                );
              }
              
              return (
                <>
                  {/* ─── ASIGNAR NUEVAS ─── */}
                  {pendientes > 0 && (
                    <>
                      <Text style={[s.modalSubtitle, {textAlign: 'center', marginBottom: 10}]}>
                        Quedan <Text style={{fontWeight: '800', fontSize: 20, color: C.danger}}>{pendientes}</Text> almuerzo(s) sin bebida.
                        {'\n'}Toca una bebida para asignarla al siguiente:
                      </Text>
                      <Touchable style={[s.btnPrimary, {backgroundColor: '#F4C430', marginBottom: 10, borderWidth: 2, borderColor: '#D4A843'}]} onPress={() => asignarBebidasAlmuerzos('INKA COLA 296ML')}>
                        <Text style={[s.btnPrimaryText, {color: '#120B06'}]}>INKA COLA 296ML</Text>
                      </Touchable>
                      <Touchable style={[s.btnPrimary, {backgroundColor: C.danger, marginBottom: 10}]} onPress={() => asignarBebidasAlmuerzos('COCA COLA 296ML')}>
                        <Text style={s.btnPrimaryText}>COCA COLA 296ML</Text>
                      </Touchable>
                      <Touchable style={[s.btnPrimary, {backgroundColor: C.bg, borderWidth: 2, borderColor: C.border, marginBottom: 12}]} onPress={() => asignarBebidasAlmuerzos('REFRESCO DEL DÍA')}>
                        <Text style={[s.btnPrimaryText, {color: C.textDark}]}>REFRESCO DEL DÍA</Text>
                      </Touchable>
                    </>
                  )}

                  {pendientes === 0 && (
                    <Text style={[s.modalSubtitle, {textAlign: 'center', marginBottom: 14, color: C.successDark, fontWeight: '800'}]}>
                      ✅ Todas las bebidas están asignadas.
                    </Text>
                  )}

                  {/* ─── BEBIDAS YA ASIGNADAS ─── */}
                  {bebidasAsignadas.length > 0 && (
                    <>
                      <View style={{height: 1, backgroundColor: C.border, marginVertical: 8}} />
                      <Text style={{fontSize: 12, fontWeight: '800', color: C.textMuted, marginBottom: 8, textAlign: 'center', textTransform: 'uppercase'}}>
                        Bebidas asignadas (toca ✕ para cambiar)
                      </Text>
                      {bebidasAsignadas.map((b: any) => (
                        <View key={b.nombre} style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.surface, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, marginBottom: 6, borderWidth: 1, borderColor: C.border}}>
                          <Text style={{fontWeight: '700', fontSize: 15, color: C.textDark}}>
                            {b.nombre} <Text style={{color: C.primary, fontWeight: '800'}}>×{b.cantidad}</Text>
                          </Text>
                          <Touchable 
                            onPress={() => removerBebidaAsignada(b.nombre)}
                            style={{backgroundColor: C.dangerSoft, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center'}}
                            accessibilityLabel={`Quitar bebida ${b.nombre}`} accessibilityRole="button"
                          >
                            <Feather name="x" size={18} color={C.danger} />
                          </Touchable>
                        </View>
                      ))}
                    </>
                  )}

                  {/* ─── BOTONES DE ACCIÓN ─── */}
                  {pendientes === 0 ? (
                    <Touchable style={[s.btnPrimary, {marginTop: 12}]} onPress={() => { setUi(prev => ({ ...prev, modalBebidaDomingo: false })); enviarComanda(); }}>
                      <Text style={s.btnPrimaryText}>Listo ✓</Text>
                    </Touchable>
                  ) : (
                    <Touchable style={s.btnSecondary} onPress={() => setUi(prev => ({ ...prev, modalBebidaDomingo: false }))}>
                      <Text style={s.btnSecondaryText}>Continuar después</Text>
                    </Touchable>
                  )}
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

          {/* 🆕 Modal Historial de Cambios */}
          <Modal visible={ui.modalHistorialCambios} transparent animationType="fade">
            <View style={s.modalOverlay}>
              <View style={[s.modalCard, {maxHeight: '70%'}]}>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16}}>
                  <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                    <Feather name="rotate-ccw" size={18} color={C.danger} />
                    <Text style={s.modalTitle}>Cambios de Platos</Text>
                  </View>
                  <Touchable onPress={() => setUi(prev => ({ ...prev, modalHistorialCambios: false }))} style={{padding: 8}} accessibilityLabel="Cerrar historial de cambios" accessibilityRole="button">
                    <Feather name="x" size={22} color={C.textMuted} />
                  </Touchable>
                </View>
                {(() => {
                  const cambios = obtenerHistorialCambios(mozo.mesaActiva?.pedido || []);
                  if (cambios.length === 0) {
                    return (
                      <View style={{alignItems: 'center', padding: 30}}>
                        <Feather name="rotate-ccw" size={40} color={C.textMuted} style={{opacity: 0.3, marginBottom: 12}} />
                        <Text style={{color: C.textMuted, fontSize: 14, fontWeight: '600', textAlign: 'center'}}>No hay cambios de platos registrados en esta mesa.</Text>
                      </View>
                    );
                  }
                  return (
                    <ScrollView style={{maxHeight: 400}}>
                      {cambios.map((c: any, idx: number) => (
                        <View key={idx} style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 12,
                          borderBottomWidth: idx < cambios.length - 1 ? 1 : 0,
                          borderBottomColor: C.border
                        }}>
                          <View style={{flex: 1}}>
                            <Text style={{fontSize: 14, fontWeight: '600', color: C.danger, textDecorationLine: 'line-through'}}>
                              {c.platoOriginal}
                            </Text>
                          </View>
                          <Feather name="arrow-right" size={16} color={C.gold} style={{marginHorizontal: 12}} />
                          <View style={{flex: 1}}>
                            <Text style={{fontSize: 14, fontWeight: '700', color: C.successDark}}>
                              {c.platoNuevo}
                            </Text>
                          </View>
                          {c.categoria && (
                            <View style={{backgroundColor: C.bg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, marginLeft: 8}}>
                              <Text style={{fontSize: 12, fontWeight: '700', color: C.textMuted, textTransform: 'uppercase'}}>{c.categoria}</Text>
                            </View>
                          )}
                        </View>
                      ))}
                    </ScrollView>
                  );
                })()}
                <Touchable style={[s.btnSecondary, {marginTop: 12}]} onPress={() => setUi(prev => ({ ...prev, modalHistorialCambios: false }))}>
                  <Text style={s.btnSecondaryText}>Cerrar</Text>
                </Touchable>
              </View>
            </View>
          </Modal>

          {/* 🎫 CLUB CALLETANO — Escáner de visitas de clientes */}
          <Modal visible={club.modal} transparent animationType="fade" onRequestClose={club.cerrarClub}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
              <View style={[s.modalCard, { width: '92%', maxWidth: 560 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Text style={[s.modalTitle, { marginBottom: 0 }]}>🎫 Club Calletano</Text>
                  <Touchable onPress={club.cerrarClub} style={{ padding: 8 }} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityLabel="Cerrar club" accessibilityRole="button">
                    <Feather name="x" size={24} color={C.textMuted} />
                  </Touchable>
                </View>

                {/* ── VISTA: ESCANEAR ── */}
                {club.vista === 'escanear' && (
                  <>
                    <Text style={[s.modalSubtitle, { marginBottom: 12 }]}>
                      Escanea el QR de la tarjeta del cliente para registrar su visita.
                    </Text>

                    {/* Cámara (no disponible en web) */}
                    {Platform.OS !== 'web' &&
                      (cameraPermission?.granted ? (
                        <View style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 16, height: 240, backgroundColor: C.bg }}>
                          <CameraView
                            style={{ flex: 1 }}
                            facing="back"
                            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                            onBarcodeScanned={({ data }) => club.procesarEscaneo(data)}
                          />
                        </View>
                      ) : (
                        <Touchable
                          style={[s.btnPrimary, { backgroundColor: C.primary, marginBottom: 16 }]}
                          onPress={() => { requestCameraPermission(); }}
                        >
                          <Feather name="camera" size={18} color={C.white} style={{ marginRight: 8 }} />
                          <Text style={s.btnPrimaryText}>Permitir cámara</Text>
                        </Touchable>
                      ))}

                    <Text style={{ fontSize: 11, fontWeight: '800', color: C.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      O ingresa el documento manualmente
                    </Text>
                    <TextInput
                      style={s.modalInputCompact}
                      placeholder="DNI o CE (8 a 12 dígitos)"
                      placeholderTextColor={C.textMuted}
                      value={club.documentoManual}
                      onChangeText={t => club.setDocumentoManual(t.replace(/[^\d]/g, ''))}
                      keyboardType="number-pad"
                      maxLength={12}
                    />
                    <Touchable
                      style={[s.btnPrimary, { backgroundColor: C.gold }]}
                      onPress={() => club.buscarTarjeta(club.documentoManual)}
                      disabled={club.cargando || club.documentoManual.length < 8}
                    >
                      <Text style={[s.btnPrimaryText, { color: C.primary }]}>{club.cargando ? 'Buscando…' : 'Buscar tarjeta'}</Text>
                    </Touchable>

                    {club.mensaje !== '' && (
                      <Text style={{ color: C.danger, fontWeight: '700', marginTop: 12, textAlign: 'center', fontSize: 13 }}>{club.mensaje}</Text>
                    )}
                  </>
                )}

                {/* ── VISTA: TARJETA DEL SOCIO ── */}
                {club.vista === 'tarjeta' && club.miembro && (
                  <>
                    <View style={{ backgroundColor: '#0B3D4A', borderRadius: 18, padding: 20, marginBottom: 16 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                        <View>
                          <Text style={{ color: '#F6D35F', fontWeight: '900', letterSpacing: 1.5, fontSize: 13 }}>CLUB CALLETANO</Text>
                          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 }}>{club.sede}</Text>
                        </View>
                        <Text style={{ color: '#F6D35F', fontWeight: '900', fontSize: 22 }}>{clubProg?.porcentaje || 0}%</Text>
                      </View>
                      <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }} numberOfLines={1}>{club.miembro.nombre}</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 4, letterSpacing: 1 }}>
                        {club.miembro.tipo_documento} {club.miembro.documento}
                      </Text>
                      <Text style={{ color: '#fff', fontWeight: '700', marginTop: 16, marginBottom: 6 }}>
                        {club.miembro.visitas} de {club.meta} visitas
                      </Text>
                      <View style={{ height: 10, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' }}>
                        <View style={{ height: '100%', width: `${clubProg?.porcentaje || 0}%`, borderRadius: 99, backgroundColor: '#F6D35F' }} />
                      </View>
                    </View>

                    {club.mensaje !== '' && (
                      <Text style={{ color: C.danger, fontWeight: '700', marginBottom: 12, textAlign: 'center', fontSize: 13 }}>{club.mensaje}</Text>
                    )}

                    {club.yaVisitoHoy && (
                      <View style={{ backgroundColor: C.dangerSoft, padding: 12, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: C.danger }}>
                        <Text style={{ color: C.danger, fontWeight: '800', textAlign: 'center', fontSize: 13 }}>⚠️ Este cliente ya registró su visita hoy</Text>
                        <Text style={{ color: C.danger, fontSize: 12, textAlign: 'center', marginTop: 4 }}>Solo se cuenta una visita por día en la misma sede.</Text>
                      </View>
                    )}

                    {/* 💵 Consumo de comida de la mesa: la visita se registra solo si la boleta llega a S/ 80 */}
                    <Text style={{ fontSize: 11, fontWeight: '800', color: C.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Consumo de comida de la mesa (S/)
                    </Text>
                    <TextInput
                      style={[s.modalInputCompact, { marginBottom: 4 }]}
                      placeholder="Mínimo S/ 80 (menú, domingo o carta)"
                      placeholderTextColor={C.textMuted}
                      value={club.consumoMesa}
                      onChangeText={t => club.setConsumoMesa(t.replace(',', '.').replace(/[^\d.]/g, ''))}
                      keyboardType="decimal-pad"
                    />
                    <Text style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>
                      Solo se registra la visita si la mesa suma S/ {CONSUMO_MINIMO} o más en comida (no cuentan bebidas ni envases).
                    </Text>

                    <Touchable
                      style={[s.btnPrimary, { backgroundColor: (club.yaVisitoHoy || !consumoOk) ? C.border : C.successLight }]}
                      onPress={club.sumarVisita}
                      disabled={club.cargando || club.yaVisitoHoy || !consumoOk}
                    >
                      <Feather name="check-circle" size={18} color={(club.yaVisitoHoy || !consumoOk) ? C.textMuted : '#064E3B'} style={{ marginRight: 8 }} />
                      <Text style={[s.btnPrimaryText, { color: (club.yaVisitoHoy || !consumoOk) ? C.textMuted : '#064E3B' }]}>
                        {club.yaVisitoHoy ? 'Visita ya registrada hoy' : club.cargando ? 'Registrando…' : consumoOk ? 'SUMAR VISITA' : `Consumo mínimo: S/ ${CONSUMO_MINIMO}`}
                      </Text>
                    </Touchable>
                    <Touchable style={s.btnSecondary} onPress={club.escanearOtro}>
                      <Text style={s.btnSecondaryText}>Escanea otro cliente</Text>
                    </Touchable>
                  </>
                )}

                {/* ── VISTA: ÉXITO ── */}
                {club.vista === 'exito' && (
                  <>
                    <View style={{ alignItems: 'center', marginVertical: 20 }}>
                      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: C.successSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                        <Feather name="check" size={40} color={C.success} />
                      </View>
                      <Text style={{ fontSize: 20, fontWeight: '800', color: C.textDark, textAlign: 'center' }}>¡Visita registrada! 🎉</Text>
                      <Text style={{ fontSize: 14, color: C.textMuted, marginTop: 6, textAlign: 'center' }}>
                        <Text style={{ fontWeight: '800', color: C.textDark }}>{club.miembro?.nombre}</Text>{' '}
                        ahora tiene <Text style={{ fontWeight: '800', color: C.successDark }}>{club.visitasNuevas} de {club.meta} visitas</Text>.
                      </Text>
                      {club.visitasNuevas >= club.meta ? (
                        <Text style={{ fontSize: 14, fontWeight: '700', color: C.goldText, marginTop: 10, textAlign: 'center' }}>
                          🏆 ¡El cliente completó sus visitas! Gana su premio en caja.
                        </Text>
                      ) : club.premio ? (
                        <Text style={{ fontSize: 12, color: C.textMuted, marginTop: 10, textAlign: 'center' }}>
                          Premio al completar {club.meta} visitas: {club.premio}.
                        </Text>
                      ) : null}
                    </View>
                    <Touchable style={[s.btnPrimary, { backgroundColor: C.primary }]} onPress={club.escanearOtro}>
                      <Text style={s.btnPrimaryText}>Escanear otro cliente</Text>
                    </Touchable>
                    <Touchable style={s.btnSecondary} onPress={club.cerrarClub}>
                      <Text style={s.btnSecondaryText}>Cerrar</Text>
                    </Touchable>
                  </>
                )}
              </View>
            </KeyboardAvoidingView>
          </Modal>

    </SafeAreaView>
  );
}