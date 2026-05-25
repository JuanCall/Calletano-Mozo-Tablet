import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" backgroundColor="#212529" />
      <Stack>
        {/* Esto le dice a Expo que oculte su propia barra de navegación superior 
            para que se vea la nuestra personalizada */}
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}