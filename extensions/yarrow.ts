/**
 * Yarrow Half-Block Extension
 *
 * Renders Yarrow using Unicode half-blocks (▀▄█) with fg/bg colours.
 * Each character = 2 vertical pixels, giving finer vertical detail.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const fg = (r: number, g: number, b: number) => `${ESC}38;2;${r};${g};${b}m`;
const bg = (r: number, g: number, b: number) => `${ESC}48;2;${r};${g};${b}m`;
const bold = (s: string) => `${ESC}1m${s}${RESET}`;
const dim = (s: string) => `${ESC}2m${s}${RESET}`;

function visualWidth(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

// Raw RGB tuples — null = transparent
const BK: [number, number, number] = [17, 17, 17];
const WH: [number, number, number] = [224, 224, 224];
const PK: [number, number, number] = [224, 88, 120];
const SP = null;

type Color = [number, number, number] | null;

function sameColor(a: Color, b: Color): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

// Render one text character from two vertically-stacked pixels
function halfBlock(top: Color, bottom: Color): string {
  if (top === null && bottom === null) return " ";
  if (top !== null && bottom === null) return `${fg(...top)}▀${RESET}`;
  if (top === null && bottom !== null) return `${fg(...bottom)}▄${RESET}`;
  // both non-null
  if (sameColor(top, bottom)) return `${fg(...top!)}█${RESET}`;
  return `${fg(...top!)}${bg(...bottom!)}▀${RESET}`;
}

// 12 cols × 10 rows — thinner half-block (renders as 5 text rows)
const PIXELS: Color[][] = [
  [SP, SP, BK, BK, BK, SP, SP, BK, BK, BK, SP, SP], // ear tips
  [SP, SP, SP, BK, BK, BK, BK, BK, BK, SP, SP, SP], // top border
  [SP, SP, BK, WH, WH, WH, WH, WH, WH, BK, SP, SP], // face
  [SP, SP, BK, WH, BK, WH, WH, BK, WH, BK, SP, SP], // eyes (1px)
  [SP, SP, BK, WH, WH, WH, WH, WH, WH, BK, SP, SP], // gap
  [SP, SP, BK, WH, WH, BK, BK, WH, WH, BK, SP, SP], // nose (2px)
  [SP, SP, BK, WH, WH, WH, WH, WH, WH, BK, SP, SP], // gap
  [SP, SP, BK, WH, WH, PK, PK, WH, WH, BK, SP, SP], // tongue (2px)
  [SP, SP, BK, BK, BK, PK, PK, BK, BK, BK, SP, SP], // border+tongue (2px)
  [SP, SP, SP, SP, SP, SP, SP, SP, SP, SP, SP, SP], // transparent
];

function getArtLines(): string[] {
  const lines: string[] = [];
  for (let r = 0; r < PIXELS.length; r += 2) {
    const top = PIXELS[r];
    const bot = PIXELS[r + 1];
    let line = "";
    for (let c = 0; c < top.length; c++) {
      line += halfBlock(top[c], bot[c]);
    }
    lines.push(line);
  }
  return lines;
}

export default function (pi: ExtensionAPI) {
  let enabled = true;

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI || !enabled) return;

    ctx.ui.setHeader((_tui, _theme) => {
      return {
        render(width: number): string[] {
          const art = getArtLines();
          const name = bold(`${fg(224, 224, 224)}yarrow`);
          const version = dim(`${fg(128, 128, 128)}pi v${VERSION}`);
          const tagline = dim(`${fg(128, 128, 128)}a pi-based coding harness`);
          const textLines = [`${name}  ${version}`, tagline];

          const rightAlign = (line: string): string => {
            const vw = visualWidth(line);
            const pad = Math.max(0, width - vw);
            return " ".repeat(pad) + line;
          };

          return ["", ...art.map(rightAlign), "", ...textLines.map(rightAlign), ""];
        },
        invalidate() {},
      };
    });
  });

  pi.registerCommand("yarrow", {
    description: "Toggle Yarrow header",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      if (enabled) {
        ctx.ui.notify("Yarrow header enabled — /reload or restart to see him", "info");
      } else {
        ctx.ui.setHeader(undefined);
        ctx.ui.notify("Yarrow header disabled — built-in header restored", "info");
      }
    },
  });

  pi.registerCommand("builtin-header", {
    description: "Restore built-in header",
    handler: async (_args, ctx) => {
      enabled = false;
      ctx.ui.setHeader(undefined);
      ctx.ui.notify("Built-in header restored", "info");
    },
  });
}
