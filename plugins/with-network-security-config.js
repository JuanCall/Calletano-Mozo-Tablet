// 🛡️ Config plugin de Expo — Red segura (HTTPS obligatorio + CA de usuario).
// ============================================================
// El backend del POS escucha SOLO por HTTPS con un certificado autofirmado
// (CA "Calletano POS" generada por el equipo de la caja). Para que la tablet
// confíe en esa CA, hay que instalarla UNA vez en el dispositivo:
//   Settings → Seguridad → Más seguridad → Cifrado y credenciales →
//   Instalar un certificado → Certificado de CA
//
// Este plugin (se ejecuta en cada `expo prebuild`, incluido el build de EAS):
//   1. Escribe android/app/src/main/res/xml/network_security_config.xml con:
//        - cleartextTrafficPermitted="false"  (prohíbe TODO tráfico HTTP plano)
//        - trust-anchors: system + user        (confía en la CA instalada)
//   2. Agrega android:networkSecurityConfig="@xml/network_security_config"
//      al <application> del AndroidManifest y quita usesCleartextTraffic.
//
// Sin este plugin, Android 7+ (targetSdk ≥ 24) IGNORA las CAs de usuario y
// la tablet no podría validar el certificado autofirmado del backend.
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const XML_CONTENIDO = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generado por plugins/with-network-security-config.js (Expo config plugin). -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
            <!-- 🔓 CA de USUARIO: la "Calletano POS CA" que se instala en el
                 dispositivo confía en el HTTPS autofirmado de la caja. -->
            <certificates src="user" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;

module.exports = function withNetworkSecurityConfig(config) {
  // 1) Escribir el XML en el proyecto nativo generado.
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const resDir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(resDir, { recursive: true });
      fs.writeFileSync(path.join(resDir, 'network_security_config.xml'), XML_CONTENIDO, 'utf8');
      return config;
    },
  ]);

  // 2) Referenciar el XML en el <application> y quitar cleartext explícito.
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const app = manifest && manifest.application && manifest.application[0];
    if (app) {
      app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
      delete app.$['android:usesCleartextTraffic'];
    }
    return config;
  });

  return config;
};
