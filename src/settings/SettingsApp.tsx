import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { loadSettings, saveSettings } from "../lib/settings";
import { defaultSettings, type AppSettings, type CharacterId } from "../types";
import styles from "./SettingsApp.module.css";

const copyCharacterImage = (sourcePath: string, character: CharacterId) => invoke<string>("copy_character_image", { sourcePath, character });

export function SettingsApp() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [ready, setReady] = useState(false);
  useEffect(() => { loadSettings().then((s) => { setSettings(s); setReady(true); }); }, []);
  useEffect(() => { if (ready) void saveSettings(settings); }, [settings, ready]);
  const patch = (next: Partial<AppSettings>) => setSettings((s) => ({ ...s, ...next }));
  const patchCharacter = (id: CharacterId, next: Partial<AppSettings["characters"][CharacterId]>) => setSettings((s) => ({ ...s, characters: { ...s.characters, [id]: { ...s.characters[id], ...next } } }));
  const chooseImage = async (id: CharacterId) => {
    const selected = await open({ multiple: false, filters: [{ name: "이미지", extensions: ["png", "jpg", "jpeg", "webp"] }] });
    if (!selected || Array.isArray(selected)) return;
    try { patchCharacter(id, { imagePath: await copyCharacterImage(selected, id) }); }
    catch (error) { alert(error instanceof Error ? error.message : "이미지를 가져오지 못했습니다."); }
  };
  const toggleTop = async (value: boolean) => { patch({ alwaysOnTop: value }); await invoke("set_always_on_top", { value }); };
  const toggleLock = async (value: boolean) => { patch({ locked: value }); await invoke("set_locked", { locked: value }); };
  const changeLayer = (id: CharacterId) => { const other: CharacterId = id === "a" ? "b" : "a"; setSettings((s) => ({ ...s, characters: { ...s.characters, [id]: { ...s.characters[id], zIndex: s.characters[other].zIndex }, [other]: { ...s.characters[other], zIndex: s.characters[id].zIndex } } })); };
  if (!ready) return null;
  return <main className={styles.page}>
    <header><div><span className={styles.kicker}>CHARPET</span><h1>위젯 설정</h1></div><button className={styles.close} onClick={() => void getCurrentWindow().hide()}>×</button></header>
    <section className={styles.card}><h2>기념일</h2><label>이름<input value={settings.anniversaryName} onChange={(e) => patch({ anniversaryName: e.target.value })} /></label><label>날짜<input type="date" value={settings.anniversaryDate} onChange={(e) => patch({ anniversaryDate: e.target.value })} /></label>
      <div className={styles.row}><label>유형<select value={settings.anniversaryType} onChange={(e) => patch({ anniversaryType: e.target.value as AppSettings["anniversaryType"] })}><option value="start">시작일 (D+)</option><option value="upcoming">예정일 (D-)</option></select></label><Toggle label="시작일을 1일째로" checked={settings.countStartDay} onChange={(countStartDay) => patch({ countStartDay })} /></div>
    </section>
    {(["a", "b"] as CharacterId[]).map((id) => { const c = settings.characters[id]; const title = id === "a" ? "캐릭터 A · 왼쪽" : "캐릭터 B · 오른쪽"; return <section className={styles.card} key={id}><h2>{title}</h2><div className={styles.characterRow}><button className={styles.imageButton} onClick={() => void chooseImage(id)}>{c.imagePath ? <img src={convertFileSrc(c.imagePath)} /> : <span>이미지<br/>선택</span>}</button><div><button className={styles.layerButton} onClick={() => changeLayer(id)}>앞/뒤 순서 바꾸기</button><Range label="확대/축소" value={c.scale} min={0.3} max={2} step={0.05} onChange={(scale) => patchCharacter(id, { scale })} /><Range label="X 위치" value={c.x} min={-160} max={160} step={1} onChange={(x) => patchCharacter(id, { x })} /><Range label="Y 위치" value={c.y} min={-100} max={100} step={1} onChange={(y) => patchCharacter(id, { y })} /></div></div><label>기본 말풍선<input value={c.defaultBubble} onChange={(e) => patchCharacter(id, { defaultBubble: e.target.value })} /></label><label>클릭 말풍선<input value={c.clickBubble} onChange={(e) => patchCharacter(id, { clickBubble: e.target.value })} /></label><label>드래그 말풍선<input value={c.dragBubble} onChange={(e) => patchCharacter(id, { dragBubble: e.target.value })} /></label></section>; })}
    <section className={styles.card}><h2>위젯 동작</h2><Toggle label="항상 위에 표시" checked={settings.alwaysOnTop} onChange={(v) => void toggleTop(v)} /><Toggle label="잠금 (클릭 통과)" checked={settings.locked} onChange={(v) => void toggleLock(v)} /></section>
  </main>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className={styles.toggle}>{label}<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span /></label>; }
function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) { return <label className={styles.range}>{label}<output>{value}</output><input type="range" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} /></label>; }
