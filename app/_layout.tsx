import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
// 🛡️ Registra el interceptor global que envía el token compartido (x-club-key)
// en todas las llamadas de axios al backend local.
import '../src/lib/apiClient';

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden');
      // Nota: setBehaviorAsync no es compatible con edgeToEdgeEnabled:true.
      // El plugin expo-navigation-bar de app.json (hidden:true) aplica solo en
      // builds nativos; por eso la llamada runtime de arriba se mantiene: cubre
      // Expo Go y es idempotente en los builds nativos.
    }
  }, []);

  return (
    <>
      <StatusBar style="light" backgroundColor="#212529" hidden={true} />
      <Stack>
        {/* Esto le dice a Expo que oculte su propia barra de navegación superior 
            para que se vea la nuestra personalizada */}
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}