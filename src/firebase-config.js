// firebase-config.js
// ⚠️ Ubicado fuera de app/ a propósito: expo-router escanea app/ como rutas
// y este módulo no es una pantalla (no exporta un componente React).
import { initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: "AIzaSyC2RKkuY_aEQaHVDvAt_-T_29sPQ6HUp50",
  authDomain: "calletano-restaurant.firebaseapp.com",
  projectId: "calletano-restaurant",
  storageBucket: "calletano-restaurant.firebasestorage.app",
  messagingSenderId: "1036720006578",
  appId: "1:1036720006578:web:31b305a61a353f324bb0ab",
  measurementId: "G-VBPRFGMZ1J"
};

// 🛡️ Inicializar Firebase de forma SEGURA: si algo falla aquí (red, crypto, persistencia),
// la app NO debe cerrarse — solo se degrada y sigue funcionando con la Caja local.
/** @type {import('firebase/auth').Auth} */
let auth;
/**
 * @type {import('firebase/firestore').Firestore}
 * Si Firebase no inicializa, `db` queda undefined y las llamadas a Firestore
 * fallan dentro de los try/catch de los hooks (la app no se cierra).
 */
let db;

// 🟢 LÓGICA MULTIPLATAFORMA
// Si abres la app en el navegador de tu computadora, Firebase usa su persistencia web por defecto.
// Si la abres en el celular (Expo Go o APK), usa el almacenamiento de React Native.
try {
  const app = initializeApp(firebaseConfig);
  if (Platform.OS === 'web') {
    auth = getAuth(app);
  } else {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage)
    });
  }
  db = getFirestore(app);
} catch (e) {
  console.warn('[Calletano] Firebase no inicializado (modo degradado):', e);
}

export { auth, db };
