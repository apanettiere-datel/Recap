const {
  withXcodeProject,
  withDangerousMod,
  withAndroidManifest,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const WIDGET_NAME = "RecapWidgetExtension";

// ---------------------------------------------------------------------------
// iOS: SwiftUI WidgetKit extension
// ---------------------------------------------------------------------------
const IOS_WIDGET_SWIFT = `import WidgetKit
import SwiftUI

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SimpleEntry {
        SimpleEntry(date: Date())
    }
    func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> ()) {
        completion(SimpleEntry(date: Date()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<SimpleEntry>) -> ()) {
        completion(Timeline(entries: [SimpleEntry(date: Date())], policy: .never))
    }
}

struct SimpleEntry: TimelineEntry {
    let date: Date
}

struct RecapWidgetEntryView: View {
    var entry: Provider.Entry

    var body: some View {
        ZStack {
            Color.black
            VStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(Color.red.opacity(0.2))
                        .frame(width: 52, height: 52)
                    Image(systemName: "mic.fill")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundColor(.red)
                }
                Text("Record")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
            }
        }
        .widgetURL(URL(string: "recap:///recording"))
    }
}

@main
struct RecapWidget: Widget {
    let kind: String = "RecapWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            if #available(iOS 17.0, *) {
                RecapWidgetEntryView(entry: entry)
                    .containerBackground(.black, for: .widget)
            } else {
                RecapWidgetEntryView(entry: entry)
            }
        }
        .configurationDisplayName("Quick Record")
        .description("Tap to start recording a conversation.")
        .supportedFamilies([.systemSmall])
    }
}
`;

const IOS_INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.widgetkit-extension</string>
    </dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>Recap Widget</string>
    <key>CFBundleExecutable</key>
    <string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleIdentifier</key>
    <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>$(PRODUCT_NAME)</string>
    <key>CFBundlePackageType</key>
    <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
    <key>CFBundleShortVersionString</key>
    <string>$(MARKETING_VERSION)</string>
    <key>CFBundleVersion</key>
    <string>$(CURRENT_PROJECT_VERSION)</string>
</dict>
</plist>
`;

// ---------------------------------------------------------------------------
// Android: AppWidgetProvider + layouts
// ---------------------------------------------------------------------------
const ANDROID_WIDGET_KOTLIN = `package com.recap.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import com.recap.app.R

class RecapWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("recap:///recording"))
            val pendingIntent = PendingIntent.getActivity(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val views = RemoteViews(context.packageName, R.layout.recap_widget)
            views.setOnClickPendingIntent(R.id.widget_container, pendingIntent)
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
`;

const ANDROID_WIDGET_LAYOUT = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_container"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@drawable/widget_background"
    android:gravity="center"
    android:orientation="vertical"
    android:padding="12dp">

    <ImageView
        android:layout_width="40dp"
        android:layout_height="40dp"
        android:src="@drawable/ic_mic_widget"
        android:contentDescription="Record" />

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:text="Record"
        android:textColor="#FFFFFF"
        android:textSize="13sp"
        android:textStyle="bold" />
</LinearLayout>
`;

const ANDROID_WIDGET_INFO = `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="110dp"
    android:minHeight="110dp"
    android:updatePeriodMillis="0"
    android:initialLayout="@layout/recap_widget"
    android:resizeMode="none"
    android:widgetCategory="home_screen"
    android:previewLayout="@layout/recap_widget"
    android:description="@string/widget_description" />
`;

const ANDROID_WIDGET_BG = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="#1C1C1E" />
    <corners android:radius="16dp" />
</shape>
`;

const ANDROID_MIC_ICON = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FF3B30"
        android:pathData="M12,14c1.66,0 3,-1.34 3,-3V5c0,-1.66 -1.34,-3 -3,-3S9,3.34 9,5v6C9,12.66 10.34,14 12,14zM17.3,11c0,2.93 -2.37,5.3 -5.3,5.3S6.7,13.93 6.7,11H5c0,3.41 2.72,6.23 6,6.72V21h2v-3.28c3.28,-0.49 6,-3.31 6,-6.72H17.3z" />
</vector>
`;

// ---------------------------------------------------------------------------
// iOS config plugin
// ---------------------------------------------------------------------------
function withIosWidgetFiles(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const widgetDir = path.join(
        config.modRequest.projectRoot,
        "ios",
        WIDGET_NAME
      );
      fs.mkdirSync(widgetDir, { recursive: true });
      fs.writeFileSync(path.join(widgetDir, "RecapWidget.swift"), IOS_WIDGET_SWIFT);
      fs.writeFileSync(path.join(widgetDir, "Info.plist"), IOS_INFO_PLIST);
      return config;
    },
  ]);
}

function withIosWidgetTarget(config) {
  return withXcodeProject(config, async (config) => {
    const project = config.modResults;
    const mainBundleId = config.ios?.bundleIdentifier || "com.recap.app";
    const widgetBundleId = `${mainBundleId}.widget`;

    // Add the widget extension target
    const target = project.addTarget(
      WIDGET_NAME,
      "app_extension",
      WIDGET_NAME,
      widgetBundleId
    );

    // Create a PBXGroup for widget source files
    const groupKey = project.pbxCreateGroup(WIDGET_NAME, WIDGET_NAME);

    // Add the group to the project's main group
    const mainGroupKey = project.getFirstProject().firstProject.mainGroup;
    const mainGroup =
      project.hash.project.objects["PBXGroup"][mainGroupKey];
    if (mainGroup && mainGroup.children) {
      mainGroup.children.push({ value: groupKey, comment: WIDGET_NAME });
    }

    // Add the Swift source file to the widget group and target build phase
    project.addSourceFile(
      `${WIDGET_NAME}/RecapWidget.swift`,
      { target: target.uuid },
      groupKey
    );

    // Update build settings for the widget target configurations
    const configListKey = target.pbxNativeTarget.buildConfigurationList;
    const configLists =
      project.hash.project.objects["XCConfigurationList"];
    const configList = configLists[configListKey];

    if (configList && configList.buildConfigurations) {
      const allConfigs =
        project.hash.project.objects["XCBuildConfiguration"];
      for (const ref of configList.buildConfigurations) {
        const bc = allConfigs[ref.value];
        if (!bc || !bc.buildSettings) continue;
        bc.buildSettings.SWIFT_VERSION = "5.0";
        bc.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = "16.0";
        bc.buildSettings.INFOPLIST_FILE = `"${WIDGET_NAME}/Info.plist"`;
        bc.buildSettings.CODE_SIGN_STYLE = "Automatic";
        bc.buildSettings.CURRENT_PROJECT_VERSION = "1";
        bc.buildSettings.MARKETING_VERSION = "1.0";
        bc.buildSettings.TARGETED_DEVICE_FAMILY = '"1"';
        bc.buildSettings.GENERATE_INFOPLIST_FILE = "NO";
        bc.buildSettings.LD_RUNPATH_SEARCH_PATHS =
          '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"';
        bc.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${widgetBundleId}"`;
        bc.buildSettings.SKIP_INSTALL = "YES";
      }
    }

    // Embed the widget extension in the main app bundle
    const mainTarget = project.getFirstTarget();
    project.addBuildPhase(
      [`${WIDGET_NAME}.appex`],
      "PBXCopyFilesBuildPhase",
      "Embed App Extensions",
      mainTarget.firstTarget.uuid,
      "plugins"
    );

    return config;
  });
}

// ---------------------------------------------------------------------------
// Android config plugin
// ---------------------------------------------------------------------------
function withAndroidWidgetFiles(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const androidBase = path.join(projectRoot, "android", "app", "src", "main");

      // Kotlin source
      const kotlinDir = path.join(
        androidBase,
        "java",
        "com",
        "recap",
        "app",
        "widget"
      );
      fs.mkdirSync(kotlinDir, { recursive: true });
      fs.writeFileSync(
        path.join(kotlinDir, "RecapWidgetProvider.kt"),
        ANDROID_WIDGET_KOTLIN
      );

      // Layout
      const layoutDir = path.join(androidBase, "res", "layout");
      fs.mkdirSync(layoutDir, { recursive: true });
      fs.writeFileSync(
        path.join(layoutDir, "recap_widget.xml"),
        ANDROID_WIDGET_LAYOUT
      );

      // Widget info
      const xmlDir = path.join(androidBase, "res", "xml");
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(
        path.join(xmlDir, "recap_widget_info.xml"),
        ANDROID_WIDGET_INFO
      );

      // Drawables
      const drawableDir = path.join(androidBase, "res", "drawable");
      fs.mkdirSync(drawableDir, { recursive: true });
      fs.writeFileSync(
        path.join(drawableDir, "widget_background.xml"),
        ANDROID_WIDGET_BG
      );
      fs.writeFileSync(
        path.join(drawableDir, "ic_mic_widget.xml"),
        ANDROID_MIC_ICON
      );

      // String resource for widget description
      const valuesDir = path.join(androidBase, "res", "values");
      const stringsPath = path.join(valuesDir, "widget_strings.xml");
      fs.writeFileSync(
        stringsPath,
        `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="widget_description">Tap to start recording a conversation.</string>\n</resources>\n`
      );

      return config;
    },
  ]);
}

function withAndroidWidgetManifest(config) {
  return withAndroidManifest(config, async (config) => {
    const manifest = config.modResults;
    const app = manifest.manifest.application[0];

    if (!app.receiver) {
      app.receiver = [];
    }

    // Avoid duplicates
    const exists = app.receiver.some(
      (r) => r.$?.["android:name"] === ".widget.RecapWidgetProvider"
    );
    if (!exists) {
      app.receiver.push({
        $: {
          "android:name": ".widget.RecapWidgetProvider",
          "android:exported": "true",
        },
        "intent-filter": [
          {
            action: [
              {
                $: {
                  "android:name": "android.appwidget.action.APPWIDGET_UPDATE",
                },
              },
            ],
          },
        ],
        "meta-data": [
          {
            $: {
              "android:name": "android.appwidget.provider",
              "android:resource": "@xml/recap_widget_info",
            },
          },
        ],
      });
    }

    return config;
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
module.exports = function withRecordWidget(config) {
  config = withIosWidgetFiles(config);
  config = withIosWidgetTarget(config);
  config = withAndroidWidgetFiles(config);
  config = withAndroidWidgetManifest(config);
  return config;
};
