// 🟢 ENTRY POINT PRINCIPAL
// IMPORTANTE: Estos polyfills DEBEN cargarse ANTES que cualquier otro código.
// El SDK web de Firebase (firebase/auth, firebase/firestore) requiere
// `crypto.getRandomValues` y un `URL`/`URLSearchParams` completo en React Native.
// Sin ellos, la app lanza una excepción al arrancar y el APK se cierra de inmediato.
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

import 'expo-router/entry';
