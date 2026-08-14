// 🛡️ Cliente API de la tablet — inyecta el token compartido (header `x-club-key`)
// en TODAS las llamadas al backend local. Debe coincidir con CLUB_API_KEY del
// servidor (.env) o con el valor por defecto de backend/middleware/clubAuth.js.
//
// Basta con importar este módulo una vez (app/_layout.tsx): al ser axios un
// singleton, el interceptor se aplica a todas las llamadas de los hooks.
import axios from 'axios';

// Se exporta para reutilizarlo en el handshake de Socket.IO (useAppSystem).
export const CLUB_API_KEY = 'calletano-club-key-2026';

axios.interceptors.request.use((config) => {
  config.headers = config.headers || {};
  config.headers['x-club-key'] = CLUB_API_KEY;
  return config;
});

export default axios;
