import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { dDayLabel } from "../lib/date";
import { loadSettings, saveSettings } from "../lib/settings";
import { defaultSettings, type AppSettings, type CharacterId } from "../types";
import styles from "./WidgetApp.module.css";

const CLICK_DISTANCE = 5;
export function WidgetApp() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [bubble, setBubble] = useState(defaultSettings.characters.a.defaultBubble);
  const [active, setActive] = useState<CharacterId | null>(null);
  const [dragging, setDragging] = useState<CharacterId | null>(null);
  const down = useRef<{ x: number; y: number; id: CharacterId } | null>(null);
  useEffect(() => {
    void loadSettings().then((loaded) => {
      setSettings(loaded);
      void invoke("set_always_on_top", { value: loaded.alwaysOnTop });
      void invoke("set_locked", { locked: loaded.locked });
    });
    const timer = window.setInterval(() => void loadSettings().then(setSettings), 450);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<boolean>("lock-changed", (e) => setSettings((s) => {
      const next = { ...s, locked: e.payload };
      void saveSettings(next);
      return next;
    })).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);
  const onPointerDown = (id: CharacterId, event: React.PointerEvent) => { if (settings.locked) return; down.current = { x: event.screenX, y: event.screenY, id }; event.currentTarget.setPointerCapture(event.pointerId); };
  const onPointerMove = (event: React.PointerEvent) => { const point = down.current; if (!point || dragging) return; if (Math.hypot(event.screenX - point.x, event.screenY - point.y) >= CLICK_DISTANCE) { setDragging(point.id); setBubble(settings.characters[point.id].dragBubble); void getCurrentWindow().startDragging(); } };
  const onPointerUp = () => { const point = down.current; if (!point) return; if (!dragging) { setActive(point.id); setBubble(settings.characters[point.id].clickBubble); window.setTimeout(() => setActive(null), 500); } else { void invoke("persist_widget_position"); } setDragging(null); down.current = null; };
  const ordered = (["a", "b"] as CharacterId[]).sort((a, b) => settings.characters[a].zIndex - settings.characters[b].zIndex);
  const openSettings = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const settingsWindow = await WebviewWindow.getByLabel("settings");
    await settingsWindow?.show();
    await settingsWindow?.setFocus();
  };
  return <main className={styles.widget} aria-label="Couple D-Day widget">
    <section className={styles.card}>
      <button className={styles.settingsButton} aria-label="Open settings" title="Settings" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => void openSettings(e)}>&#9881;</button>
      <div className={styles.title}>{settings.anniversaryName}</div>
      <div className={styles.dday}>{dDayLabel(settings)}</div>
      <div className={styles.stage}>
        {ordered.map((id) => {
          const character = settings.characters[id];
          return <div key={id} className={`${styles.character} ${active === id ? styles.bounce : ""} ${dragging === id ? styles.shake : ""}`} style={{ transform: `translate(${character.x}px, ${character.y}px) scale(${character.scale})`, zIndex: character.zIndex }} onPointerDown={(e) => onPointerDown(id, e)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            {character.imagePath ? <img draggable={false} src={convertFileSrc(character.imagePath)} /> : <div className={styles.placeholder}>{id === "a" ? "A" : "B"}</div>}
          </div>;
        })}
        <div className={styles.bubble}>{bubble}</div>
      </div>
    </section>
  </main>;
}
