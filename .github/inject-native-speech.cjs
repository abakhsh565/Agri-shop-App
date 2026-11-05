/**
 * Put the microphone plugin into the generated Android project.
 *
 * `android/` is recreated by the APK workflow (`rm -rf android && npx cap add android`), so a
 * plugin written only into that folder is lost on the next release. This script copies the
 * tracked implementation into the generated project, registers it before the Capacitor bridge
 * starts, and adds the runtime microphone permission plus the Android 11+ recognition-service
 * visibility query.
 *
 * Usage: node .github/inject-native-speech.cjs   (after cap sync, before Gradle)
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const source = path.join(root, 'native', 'android', 'SpeechRecognitionPlugin.java');
const packageDir = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'agrishop', 'app');
const pluginTarget = path.join(packageDir, 'SpeechRecognitionPlugin.java');
const activityTarget = path.join(packageDir, 'MainActivity.java');
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

if (!fs.existsSync(source) || !fs.existsSync(manifestPath)) {
  console.error('Native speech injection needs native/android and a generated android/ project.');
  process.exit(1);
}

fs.mkdirSync(packageDir, { recursive: true });
fs.copyFileSync(source, pluginTarget);

fs.writeFileSync(
  activityTarget,
  `package com.agrishop.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SpeechRecognitionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`,
);

let xml = fs.readFileSync(manifestPath, 'utf8');

if (!xml.includes('android.permission.RECORD_AUDIO')) {
  xml = xml.replace(
    /(\s*<application)/,
    '\n    <uses-permission android:name="android.permission.RECORD_AUDIO" />$1',
  );
}

if (!xml.includes('android.speech.RecognitionService')) {
  xml = xml.replace(
    /(\s*<application)/,
    '\n    <queries>\n        <intent>\n            <action android:name="android.speech.RecognitionService" />\n        </intent>\n    </queries>$1',
  );
}

fs.writeFileSync(manifestPath, xml);
console.log('Native speech plugin, RECORD_AUDIO and recognition-service query injected.');