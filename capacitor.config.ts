import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.ligux.app',
  appName: 'Ligux',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: [
      '*.tunnelmole.net',
      '*.loca.lt',
      '*.trycloudflare.com',
      'raw.githubusercontent.com',
      'cdn.jsdelivr.net',
      '192.168.1.27',
      '*.google.com',
      'accounts.google.com',
      '*.googleusercontent.com',
      'sdk.cloud.google.com',
      'github.com',
      '*.githubusercontent.com',
    ],
  },
}

export default config
