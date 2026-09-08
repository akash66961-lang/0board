"use client";

import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

export default function ExcalidrawEditor() {
  return (
    <div style={{ width: "100%", height: "100vh" }}>
      <Excalidraw />
    </div>
  );
}