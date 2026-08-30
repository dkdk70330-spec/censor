export type AnniversaryType = "start" | "upcoming";
export type CharacterId = "a" | "b";

export interface CharacterSettings {
  imagePath: string | null;
  scale: number;
  x: number;
  y: number;
  zIndex: number;
  defaultBubble: string;
  clickBubble: string;
  dragBubble: string;
}

export interface AppSettings {
  anniversaryName: string;
  anniversaryDate: string;
  anniversaryType: AnniversaryType;
  countStartDay: boolean;
  alwaysOnTop: boolean;
  locked: boolean;
  widgetVisible: boolean;
  characters: Record<CharacterId, CharacterSettings>;
}

export const defaultSettings: AppSettings = {
  anniversaryName: "우리의 기념일",
  anniversaryDate: new Date().toISOString().slice(0, 10),
  anniversaryType: "start",
  countStartDay: false,
  alwaysOnTop: true,
  locked: false,
  widgetVisible: true,
  characters: {
    a: { imagePath: null, scale: 1, x: -66, y: 0, zIndex: 1, defaultBubble: "오늘도 좋아해!", clickBubble: "앗, 간지러워!", dragBubble: "어디 가는 거야?" },
    b: { imagePath: null, scale: 1, x: 66, y: 0, zIndex: 2, defaultBubble: "함께라서 행복해", clickBubble: "히히!", dragBubble: "꼭 잡아줘!" }
  }
};
