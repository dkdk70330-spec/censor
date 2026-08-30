import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SettingsApp } from "./settings/SettingsApp";
import { WidgetApp } from "./widget/WidgetApp";
import "./global.css";

const isSettings = getCurrentWindow().label === "settings";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isSettings ? <SettingsApp /> : <WidgetApp />}</React.StrictMode>
);
