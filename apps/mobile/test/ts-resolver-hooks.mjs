import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];
const ALREADY_EXPLICIT = /\.[cm]?[jt]sx?$/;

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !ALREADY_EXPLICIT.test(specifier)) {
    const base = new URL(specifier, context.parentURL);
    for (const extension of EXTENSIONS) {
      const candidate = new URL(base.href + extension);
      if (existsSync(fileURLToPath(candidate))) {
        return next(candidate.href, context);
      }
    }
  }
  return next(specifier, context);
}
