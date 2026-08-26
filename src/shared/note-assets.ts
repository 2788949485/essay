import type { JSONContent } from "@tiptap/react";

export const ASSET_URL_PREFIX = "suiji-asset://";

export function assetFileNameFromUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith(ASSET_URL_PREFIX)) return null;
  const name = decodeURIComponent(url.slice(ASSET_URL_PREFIX.length));
  return /^[\w.-]+$/.test(name) && name !== "." && name !== ".." ? name : null;
}

export function collectAssetFileNames(content: JSONContent | null | undefined): Set<string> {
  const names = new Set<string>();
  const walk = (node: JSONContent | null | undefined) => {
    if (!node) return;
    const name = assetFileNameFromUrl(node.attrs?.src);
    if (name) names.add(name);
    node.content?.forEach(walk);
  };
  walk(content);
  return names;
}
