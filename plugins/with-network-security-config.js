// 🛡️ Config plugin de Expo — Red segura (HTTPS obligatorio + CA de Calletano).
// ============================================================
// El backend del POS escucha SOLO por HTTPS con un certificado autofirmado
// (CA "Calletano POS" generada por el equipo de la caja, en ../tls/ca.crt).
//
// En vez de exigir instalar la CA manualmente en cada dispositivo (Settings →
// Instalar certificado), este plugin la INCRUSTA dentro del APK en
// res/raw/calletano_ca.crt y la declara como trust-anchor en el
// network_security_config. Así la app confía directamente en el certificado
// del backend, sin pasos manuales — en el emulador y en la tablet real.
//
// Este plugin (se ejecuta en cada `expo prebuild`, incluido el build de EAS):
//   1. Copia ../tls/ca.crt → android/app/src/main/res/raw/calletano_ca.crt
//   2. Escribe android/app/src/main/res/xml/network_security_config.xml:
//        - cleartextTrafficPermitted="false"  (prohíbe TODO tráfico HTTP plano)
//        - trust-anchors: system + CA incrustada (Calletano)
//   3. Escribe android/app/src/debug/res/xml/network_security_config.xml
//      (variante DEBUG solamente) con cleartext PERMITIDO: en desarrollo la
//      app carga el bundle JS desde Metro por http://IP:8081, y el atributo
//      usesCleartextTraffic se IGNORA cuando hay networkSecurityConfig.
//      Release sigue siendo 100% HTTPS (el XML de debug no aplica).
//   4. Agrega android:networkSecurityConfig="@xml/network_security_config"
//      al <application> del AndroidManifest y quita usesCleartextTraffic.
//
// ⚠️ Si regeneras el certificado del backend (tls/ca.crt), recompila la app
// para que tome la CA nueva.
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// La CA se busca en este orden:
//   1. mozo-tablet/tls/ca.crt  — copia DENTRO del proyecto (viaja en el upload
//      de EAS; es la que se incrusta en el APK). ¡Mantener sincronizada con la
//      CA real del backend (tls/ca.crt de la raíz del monorepo)!
//   2. ../../tls/ca.crt        — raíz del monorepo (dev local). Fuera del
//      proyecto de EAS, así que NO llega a los builds en la nube.
const CA_LOCAL = path.resolve(__dirname, '../tls/ca.crt');
const CA_LEGACY = path.resolve(__dirname, '../../tls/ca.crt');
const CA_SOURCE = fs.existsSync(CA_LOCAL) ? CA_LOCAL : (fs.existsSync(CA_LEGACY) ? CA_LEGACY : null);
const CA_RAW_NAME = 'calletano_ca'; // nombre de recurso Android (res/raw/calletano_ca.crt)

// La CA se incrusta SOLO si existe el archivo. Si no (p. ej. build de CI o EAS
// sin la carpeta tls/ disponible), el XML NO referencia @raw/calletano_ca:
// un recurso inexistente rompería el build con un error AAPT
// ("resource raw/calletano_ca not found").
const tieneCA = () => !!CA_SOURCE && fs.existsSync(CA_SOURCE);

const XML_MAIN = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generado por plugins/with-network-security-config.js (Expo config plugin). -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
            ${tieneCA() ? `<!-- 🔐 CA de Calletano incrustada en el APK: confía en el HTTPS
                 autofirmado de la caja sin instalar nada en el dispositivo. -->
            <certificates src="@raw/${CA_RAW_NAME}" />` : ''}
        </trust-anchors>
    </base-config>
</network-security-config>
`;

// Variante DEBUG: permite cleartext SOLO en desarrollo (Metro sirve el bundle
// por http://IP:8081). La confianza en la CA incrustada se mantiene igual.
const XML_DEBUG = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generado por plugins/with-network-security-config.js (solo variante DEBUG). -->
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
            ${tieneCA() ? `<!-- 🔐 CA de Calletano incrustada en el APK. -->
            <certificates src="@raw/${CA_RAW_NAME}" />` : ''}
        </trust-anchors>
    </base-config>
</network-security-config>
`;

function escribirXML(platformProjectRoot, relPath, contenido) {
  const dir = path.join(platformProjectRoot, relPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'network_security_config.xml'), contenido, 'utf8');
}

function copiarCA(platformProjectRoot) {
  const destDir = path.join(platformProjectRoot, 'app/src/main/res/raw');
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `${CA_RAW_NAME}.crt`);
  if (tieneCA()) {
    fs.copyFileSync(CA_SOURCE, dest);
  } else {
    // No hay CA disponible (ej: build de CI/EAS sin la carpeta tls/): el XML
    // tampoco la referencia, así que el build no se rompe (ver XML_MAIN/XML_DEBUG).
    console.warn('[with-network-security-config] ⚠️ No se encontró la CA (tls/ca.crt del proyecto ni ../../tls/ca.crt) — el APK NO confiará en el HTTPS autofirmado de la caja.');
  }
}

module.exports = function withNetworkSecurityConfig(config) {
  // 1) Copiar la CA al proyecto nativo y escribir los XML (main + debug).
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      copiarCA(config.modRequest.platformProjectRoot);
      escribirXML(config.modRequest.platformProjectRoot, 'app/src/main/res/xml', XML_MAIN);
      escribirXML(config.modRequest.platformProjectRoot, 'app/src/debug/res/xml', XML_DEBUG);
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
