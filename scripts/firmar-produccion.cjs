/**
 * 🔐 Reaplica la firma de producción al proyecto Android después de un
 * `expo prebuild` (que regenera android/ y borra la configuración de firma).
 *
 * Requiere:
 *   - mozo-tablet/keys/calletano-release.keystore  (keystore PKCS12 de producción)
 *   - mozo-tablet/keys/keystore.properties         (rutas y contraseñas)
 *
 * Uso:  node scripts/firmar-produccion.cjs
 * Luego compila: cd android && ./gradlew assembleRelease
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle');
const KEYSTORE = path.join(ROOT, 'keys', 'calletano-release.keystore');
const PROPS = path.join(ROOT, 'keys', 'keystore.properties');

const LOADER = `// 🔐 Firma de producción con keystore propia (configuración local, NO subir a git).
// Los datos viven en mozo-tablet/keys/keystore.properties (regenerables con
// scripts/firmar-produccion.cjs). Si no existen, el build release FALLA a propósito
// para nunca distribuir un APK firmado con la clave debug por accidente.
def keystorePropertiesFile = rootProject.file("../keys/keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}`;

const RELEASE_SIGNING = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }`;

const FAIL_FAST = `
// ❌ Falla explícitamente si se intenta compilar release sin firma de producción,
// para nunca distribuir por accidente un APK firmado con la clave debug.
gradle.taskGraph.whenReady { graph ->
    if (graph.allTasks.any { it.name.contains("Release") } && !keystorePropertiesFile.exists()) {
        throw new GradleException(
            "No se puede compilar release: falta mozo-tablet/keys/keystore.properties.\\n" +
            "Ejecuta: node scripts/firmar-produccion.cjs (re-aplica la firma tras un expo prebuild)."
        )
    }
}
`;

function main() {
  const errors = [];
  if (!fs.existsSync(KEYSTORE)) errors.push(`Falta la keystore: ${path.relative(ROOT, KEYSTORE)}`);
  if (!fs.existsSync(PROPS)) errors.push(`Falta: ${path.relative(ROOT, PROPS)} (contiene las contraseñas)`);
  if (!fs.existsSync(BUILD_GRADLE)) errors.push(`Falta el proyecto nativo: ${path.relative(ROOT, BUILD_GRADLE)}. Ejecuta primero: npx expo prebuild --platform android`);
  if (errors.length) {
    console.error('❌ No se puede configurar la firma:\n - ' + errors.join('\n - '));
    process.exit(1);
  }

  let gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');

  if (gradle.includes('keystorePropertiesFile')) {
    console.log('✓ android/app/build.gradle ya tiene la firma de producción configurada.');
    process.exit(0);
  }

  // 1) Cargar las propiedades después de jscFlavor, antes de "android {"
  const flavorAnchor = "def jscFlavor = 'io.github.react-native-community:jsc-android:2026004.+'\n\nandroid {";
  if (!gradle.includes(flavorAnchor)) {
    console.error('❌ No encontré la plantilla esperada en build.gradle (jscFlavor). Revisa la versión del template.');
    process.exit(1);
  }
  gradle = gradle.replace(flavorAnchor, "def jscFlavor = 'io.github.react-native-community:jsc-android:2026004.+'\n\n" + LOADER + '\n\nandroid {');

  // 2) Añadir signingConfigs.release tras el bloque debug
  const debugBlock = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;
  if (!gradle.includes(debugBlock)) {
    console.error('❌ No encontré el bloque signingConfigs debug esperado en build.gradle.');
    process.exit(1);
  }
  gradle = gradle.replace(debugBlock, RELEASE_SIGNING);

  // 3) Apuntar el buildType release a la firma de producción
  const releaseAnchor = 'signingConfig signingConfigs.debug\n            def enableShrinkResources';
  if (!gradle.includes(releaseAnchor)) {
    console.error('❌ No encontré la línea de firma del buildType release esperada en build.gradle.');
    process.exit(1);
  }
  gradle = gradle.replace(releaseAnchor, 'signingConfig signingConfigs.release\n            def enableShrinkResources');

  // 4) Fallo explícito si falta la firma (nunca firmware debug por accidente)
  gradle = gradle.trimEnd() + '\n' + FAIL_FAST;

  fs.writeFileSync(BUILD_GRADLE, gradle, 'utf8');
  console.log('✓ Firma de producción aplicada a android/app/build.gradle.');
  console.log('  Compila con: cd android && ./gradlew assembleRelease');
}

main();
