# POS-Mozo — App de Mozos para Restaurante Calletano

> Aplicación para tablets de los mozos del [Restaurante Calletano](https://calletano-restaurant.web.app) — Máncora, Talara, Piura, Perú.
> Desarrollada con **Expo / React Native**.

---

## Descripción

App instalada en las tablets de los mozos del restaurante. Se conecta en tiempo real con el servidor de la **Caja POS** (backend Express + Socket.IO) para:

- Ver el estado del restaurante (abierto/cerrado) y las **mesas** en vivo.
- Tomar **pedidos** con la carta actualizada, en tres modos: **local**, **llevar** y **delivery**.
- Mover platos entre mesas, agregar notas, ítems fuera de carta y datos de delivery.
- Gestionar el **Club Calletano**: registrar visitas de clientes y escanear el **QR de la tarjeta** con la cámara.
- Modo **admin/dueño** con login por roles (`dueno` | `mozo`).

Los datos operativos (mesas, carta, stock de extras, modo domingo) llegan en tiempo real vía **Socket.IO** desde el backend de la caja; la autenticación y los datos del Club se manejan con **Firebase (Auth + Firestore)**.

---

## Características

- 🔌 Configuración de IP del servidor POS al primer arranque (se guarda en el dispositivo).
- 🔐 Login con roles: `dueno` (admin) y `mozo`.
- 🍽️ Pedidos por mesa con carrito, modos local / llevar / delivery, notas y ítems fuera de carta.
- 🔄 Sincronización en tiempo real con la caja (Socket.IO) y respaldo vía API REST (axios).
- 🎫 **Club Calletano**: registro de visitas, consumo mínimo, escaneo de QR de tarjeta con `expo-camera`.
- 📱 Diseñada para tablets Android (compatible iOS y web para desarrollo).

---

## Tecnologías

| Tecnología | Propósito |
|---|---|
| Expo SDK 54 / React Native 0.81 | Framework de la app |
| expo-router | Navegación basada en archivos |
| Socket.IO Client | Tiempo real con el servidor de la caja POS |
| Axios | API REST del backend POS |
| Firebase Auth + Firestore | Login y datos del Club Calletano |
| expo-camera | Escaneo de QR de tarjetas del Club |

---

## Requisitos

- Node.js 18+
- [Expo CLI](https://docs.expo.dev/) y un dispositivo/emulador Android (o Expo Go para pruebas)
- El backend de la Caja POS corriendo en la red local (para tiempo real y pedidos)

## Puesta en marcha

```bash
npm install
npm start        # levanta Metro / Expo Dev Server
npm run android  # build y ejecución en Android (requiere dev client)
npm run ios      # iOS
```

> **Nota:** `index.js` carga polyfills (`react-native-get-random-values`, `react-native-url-polyfill`) **antes** que cualquier otro código; son necesarios para que el SDK web de Firebase funcione en React Native. No cambies el orden de los imports.

## Estructura

```
app/                  # Rutas de expo-router (_layout.tsx, index.tsx)
src/
  hooks/              # useAppSystem, useMozo, useAdmin, useClub, useClubAdmin
  lib/                # apiClient (API del backend POS)
  styles/             # Tema y estilos
  utils/              # helpers, lógica del Club (generada desde shared/club-core.js)
  __tests__/          # Pruebas unitarias (jest-expo)
scripts/
  firmar-produccion.cjs  # Firma de APK/AAB de producción
eas.json              # Configuración de builds EAS (Cloud)
```

---

## Build de producción

Los builds se generan con **EAS Build**:

```bash
npx eas build --platform android --profile production
```

La firma de producción se maneja con `scripts/firmar-produccion.cjs`. **Nunca subas a git** los archivos de claves (`/keys/`, `*.keystore`, `keystore.properties`) — ya están excluidos en `.gitignore`.

---

## Notas

- El código del Club Calletano (`src/utils/club-core.js`) se genera desde la fuente única `shared/club-core.js` con `npm run sync:club` — no se edita a mano.
- Proyecto asociado: [Calletano POS Desktop](https://github.com/JuanCall) (caja + backend) y [Web Calletano Restaurant](https://github.com/JuanCall/Web-Calletano-Restaurant).

---

> Desarrollado por: Juan Calle Rosales
> Contacto: juancallerosales19@gmail.com
