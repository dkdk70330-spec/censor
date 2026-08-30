import { load } from "@tauri-apps/plugin-store";
import { defaultSettings, type AppSettings } from "../types";

const STORE_FILE = "charpet-settings.json";
let storePromise = load(STORE_FILE, { autoSave: 100, defaults: {} });

export async function loadSettings(): Promise<AppSettings> {
  const store = await storePromise;
  const saved = await store.get<AppSettings>("settings");
  return saved ? { ...defaultSettings, ...saved, characters: { ...defaultSettings.characters, ...saved.characters } } : defaultSettings;
}

export async function saveSettings(settings: AppSettings) {
  const store = await storePromise;
  await store.set("settings", settings);
  await store.save();
}
