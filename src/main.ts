import { Notice, Platform, Plugin, PluginSettingTab, Setting, type App } from "obsidian";

import { DebugRingBuffer } from "./debug-log";
import {
  createKoreanImeEditorExtension,
  type ExtensionController,
} from "./editor-extension";

interface KoreanImeFixSettings {
  enabled: boolean;
  debugLogging: boolean;
  experimentalImeResetOnCursorMove: boolean;
}

const DEFAULT_SETTINGS: KoreanImeFixSettings = {
  enabled: true,
  debugLogging: false,
  experimentalImeResetOnCursorMove: false,
};

export default class KoreanImeFixPlugin extends Plugin implements ExtensionController {
  settings: KoreanImeFixSettings = DEFAULT_SETTINGS;
  readonly debugLog = new DebugRingBuffer(500);

  async onload(): Promise<void> {
    const loaded: unknown = await this.loadData();
    const stored = loaded && typeof loaded === "object" ? (loaded as Record<string, unknown>) : {};
    this.settings = {
      enabled: typeof stored.enabled === "boolean" ? stored.enabled : DEFAULT_SETTINGS.enabled,
      debugLogging:
        typeof stored.debugLogging === "boolean"
          ? stored.debugLogging
          : DEFAULT_SETTINGS.debugLogging,
      experimentalImeResetOnCursorMove:
        typeof stored.experimentalImeResetOnCursorMove === "boolean"
          ? stored.experimentalImeResetOnCursorMove
          : DEFAULT_SETTINGS.experimentalImeResetOnCursorMove,
    };

    this.registerEditorExtension(createKoreanImeEditorExtension(this));
    this.addSettingTab(new KoreanImeFixSettingTab(this.app, this));
    this.addCommand({
      id: "copy-debug-log",
      name: "Korean Render: Copy debug log",
      callback: () => {
        void this.copyDebugLog();
      },
    });
    this.addCommand({
      id: "clear-debug-log",
      name: "Korean Render: Clear debug log",
      callback: () => {
        this.debugLog.clear();
        new Notice("Korean Render: debug log cleared.");
      },
    });
  }

  isFixEnabled(): boolean {
    return Platform.isIosApp && this.settings.enabled;
  }

  isDebugEnabled(): boolean {
    return this.settings.debugLogging;
  }

  isExperimentalImeResetEnabled(): boolean {
    return Platform.isIosApp && this.settings.enabled && this.settings.experimentalImeResetOnCursorMove;
  }

  async updateSettings(next: Partial<KoreanImeFixSettings>): Promise<void> {
    const debugLoggingChanged =
      typeof next.debugLogging === "boolean" &&
      next.debugLogging !== this.settings.debugLogging;
    Object.assign(this.settings, next);
    if (debugLoggingChanged || !this.settings.debugLogging) this.debugLog.clear();
    await this.saveData(this.settings);
  }

  private async copyDebugLog(): Promise<void> {
    const output = this.debugLog.export({
      plugin: this.manifest.id,
      pluginVersion: this.manifest.version,
      iosFixActive: this.isFixEnabled(),
      experimentalImeResetOnCursorMove: this.isExperimentalImeResetEnabled(),
      debugLogging: this.settings.debugLogging,
      userAgent: navigator.userAgent,
      note: "Only short cursor-adjacent document snippets are recorded.",
    });

    try {
      await navigator.clipboard.writeText(output);
      new Notice(`Korean Render: copied ${this.debugLog.size} debug events.`);
    } catch (error) {
      console.error("Korean Render: could not copy debug log", error);
      new Notice("Korean Render: clipboard copy failed.");
    }
  }
}

class KoreanImeFixSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: KoreanImeFixPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName("Enable Korean Render")
      .setDesc("Apply the conservative workaround on iOS/iPadOS only.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
          await this.plugin.updateSettings({ enabled: value });
        }),
      );

    new Setting(this.containerEl)
      .setName("Debug logging")
      .setDesc("Keep up to 500 recent input events and short cursor-adjacent text snippets in memory.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.debugLogging).onChange(async (value) => {
          await this.plugin.updateSettings({ debugLogging: value });
        }),
      );

    new Setting(this.containerEl)
      .setName("Experimental IME reset on cursor move")
      .setDesc(
        "Diagnostic iOS/iPadOS experiment. Briefly blurs and refocuses the editor after a confirmed Korean pseudo-composition moves; the software keyboard may flicker or dismiss.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.experimentalImeResetOnCursorMove)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ experimentalImeResetOnCursorMove: value });
          }),
      );
  }
}
