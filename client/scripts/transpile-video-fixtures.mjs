import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
export async function compileVideoFixtures(root, temp) {
  for (const name of ["components/media-video", "components/video-player-core", "components/reel-player", "lib/video-playback-coordinator", "lib/video-preferences", "lib/use-double-tap", "lib/reel-gestures", "lib/reel-queue", "lib/reel-watch", "lib/reel-watch-transport", "lib/api/client", "lib/api/operations"]) {
    let source = await readFile(join(root, "src", name + (name.startsWith("lib") ? ".ts" : ".tsx")), "utf8");
    source = source.replace('from "next/navigation"', 'from "./video-navigation.mjs"')
      .replace('from "next/link"', 'from "./video-link.mjs"')
      .replace('from "@/lib/video-preferences"', 'from "./video-preferences.mjs"')
      .replace('from "./video-playback-coordinator"', 'from "./video-playback-coordinator.mjs"')
      .replace('from "@/lib/video-playback-coordinator"', 'from "./video-playback-coordinator.mjs"')
      .replace('from "./media-video"', 'from "./media-video.mjs"')
       .replace('from "./video-player-core"', 'from "./video-player-core.mjs"')
      .replace("from '@/lib/reel-watch'", 'from "./reel-watch.mjs"')
      .replace("from '@/lib/reel-watch-transport'", 'from "./reel-watch-transport.mjs"')
      .replace("from './api/client'", 'from "./client.mjs"')
      .replace('from "./operations"', 'from "./operations.mjs"');
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    await writeFile(join(temp, name.split("/").at(-1) + ".mjs"), output);
  }
  await writeFile(join(temp, "video-navigation.mjs"), 'export const usePathname = () => globalThis.videoTestRoute ?? "/reels";');
  await writeFile(join(temp, "video-link.mjs"), 'import React from "react"; export default function Link({children,...props}) { return React.createElement("a",props,children); }');
}
