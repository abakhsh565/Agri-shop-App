const fs = require('fs');
const path = 'android/app/src/main/AndroidManifest.xml';

if (!fs.existsSync(path)) {
  console.log('AndroidManifest.xml not found, skipping');
  process.exit(0);
}

let xml = fs.readFileSync(path, 'utf8');

if (xml.includes('android.permission.CAMERA')) {
  console.log('Camera permission already present');
  process.exit(0);
}

const perm = [
  '    <uses-permission android:name="android.permission.CAMERA" />',
  '    <uses-feature android:name="android.hardware.camera" android:required="false" />',
  '    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />',
].join('\n');

xml = xml.replace('<manifest ', '<manifest \n' + perm + '\n');
fs.writeFileSync(path, xml);
console.log('Camera permission injected successfully');
