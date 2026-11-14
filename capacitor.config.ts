import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.agrishop.app',
  appName: 'HisabPay',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
