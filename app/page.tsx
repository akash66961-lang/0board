'use client';

import dynamic from "next/dynamic";

const ExcalidrawEditor = dynamic(
  () => import("./components/Whiteboard"),
  {
    ssr: false,
  }
);

export default function Home() {
  return <ExcalidrawEditor />;
}