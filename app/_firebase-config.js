// firebase-config.js
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

// Inicializar Firebase
const app = initializeApp(firebaseConfig);

let auth;

// 🟢 LÓGICA MULTIPLATAFORMA
if (Platform.OS === 'web') {
  // Si abres la app en el navegador de tu computadora, Firebase usa su persistencia web por defecto
  auth = getAuth(app);
} else {
  // Si la abres en el celular (Expo Go o APK), usa el almacenamiento de React Native
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage)
  });
}

export const db = getFirestore(app);
export { auth };

export default function DummyScreen() { return null; }