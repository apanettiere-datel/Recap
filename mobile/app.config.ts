import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Recap",
  slug: "recap",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  scheme: "recap",
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff",
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.recap.app",
    infoPlist: {
      NSMicrophoneUsageDescription:
        "Recap needs microphone access to record conversations.",
      NSCalendarsUsageDescription:
        "Recap can add commitments to your calendar.",
      NSSpeechRecognitionUsageDescription:
        "Recap uses speech recognition to transcribe conversations.",
      // Keep recording when the screen locks or you switch apps
      UIBackgroundModes: ["audio"],
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
    package: "com.recap.app",
    permissions: ["RECORD_AUDIO", "READ_CALENDAR", "WRITE_CALENDAR", "WAKE_LOCK"],
    edgeToEdgeEnabled: true,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    [
      "expo-av",
      {
        microphonePermission:
          "Recap needs microphone access to record conversations.",
      },
    ],
    [
      "expo-calendar",
      {
        calendarPermission: "Recap can add commitments to your calendar.",
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/icon.png",
      },
    ],
    "./plugins/withRecordWidget",
  ],
  extra: {
    apiUrl: process.env.API_URL || "https://api.personalrecap.com/api",
    eas: {
      projectId: process.env.EAS_PROJECT_ID || "",
    },
  },
});
