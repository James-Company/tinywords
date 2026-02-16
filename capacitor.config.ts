import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.tinywords.app",
  appName: "TinyWords",
  webDir: "web",

  // 서버 설정
  server: {
    // 프로덕션에서는 로컬 에셋 사용 (오프라인 지원)
    // 개발 시에는 아래 url을 활성화하여 라이브 리로드 가능
    // url: "http://localhost:8787",
    androidScheme: "https",
    iosScheme: "https",
  },

  // 플러그인 설정
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: "#F7F4ED",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#F7F4ED",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
  },

  // iOS 설정
  ios: {
    contentInset: "automatic",
    preferredContentMode: "mobile",
    scheme: "TinyWords",
  },

  // Android 설정
  android: {
    allowMixedContent: true,
    backgroundColor: "#F7F4ED",
  },
};

export default config;
