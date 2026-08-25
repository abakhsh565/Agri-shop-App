import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.agrishop.app',
  appName: 'AgrishopApp',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
