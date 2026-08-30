import type { AppSettings } from "../types";

export function dDayLabel(settings: AppSettings): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const anniversary = new Date(`${settings.anniversaryDate}T00:00:00`);
  const days = Math.round((today.getTime() - anniversary.getTime()) / 86_400_000);
  if (days === 0) return "D-Day";
  if (settings.anniversaryType === "start") {
    const count = days + (settings.countStartDay ? 1 : 0);
    return count >= 0 ? `D+${count}` : `D${count}`;
  }
  const remaining = -days;
  return remaining > 0 ? `D-${remaining}` : `D+${Math.abs(remaining)}`;
}
