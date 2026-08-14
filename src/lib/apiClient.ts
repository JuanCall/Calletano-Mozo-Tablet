// 🛡️ Cliente API de la tablet — inyecta el token compartido (header `x-club-key`)
// en TODAS las llamadas al backend local. Debe coincidir con CLUB_API_KEY del
// servidor (.env raíz) y con VITE_CLUB_API_KEY de la caja.
//
// 🔑 Se lee del ENTORNO al compilar (mozo-tablet/.env → EXPO_PUBLIC_CLUB_API_KEY).
// El antiguo valor hardcodeado era público (estaba en el repo) y fue eliminado:
// sin la variable definida, la app no puede autenticarse contra el backend.
//
// Basta con importar este módulo una vez (app/_layout.tsx): al ser axios un
// singleton, el interceptor se aplica a todas las llamadas de los hooks.
import axios from 'axios';

// Se exporta para reutilizarlo en el handshake de Socket.IO (useAppSystem).
export const CLUB_API_KEY: string = process.env.EXPO_PUBLIC_CLUB_API_KEY || '';

if (!CLUB_API_KEY) {
  console.error(
    '[SEGURIDAD] Falta EXPO_PUBLIC_CLUB_API_KEY en mozo-tablet/.env. ' +
      'Define la misma clave que el backend (CLUB_API_KEY del .env raíz) y recompila la app.',
  );
}

axios.interceptors.request.use((config) => {
  config.headers = config.headers || {};
  config.headers['x-club-key'] = CLUB_API_KEY;
  return config;
});

export default axios;
