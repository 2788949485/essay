import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import type { ColorToken, TextRole } from "../constants";

export type BlockFormat = {
  textRole: TextRole;
  focusMode: boolean;
  cardMode: boolean;
  colorToken: ColorToken;
  customColor: string;
};

export const BlockFormatExtension = Extension.create({
  name: "blockFormat",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          textRole: {
            default: "body",
            parseHTML: (element) => element.getAttribute("data-text-role") || "body",
            renderHTML: (attributes) =>
              attributes.textRole && attributes.textRole !== "body" ? { "data-text-role": attributes.textRole } : {}
          },
          focusMode: {
            default: false,
            parseHTML: (element) => element.getAttribute("data-focus-mode") === "true",
            renderHTML: (attributes) => (attributes.focusMode ? { "data-focus-mode": "true" } : {})
          },
          cardMode: {
            default: false,
            parseHTML: (element) => element.getAttribute("data-card-mode") === "true",
            renderHTML: (attributes) => (attributes.cardMode ? { "data-card-mode": "true" } : {})
          },
          colorToken: {
            default: "default",
            parseHTML: (element) => (element.getAttribute("data-color-token") as ColorToken | null) || "default",
            renderHTML: (attributes) =>
              attributes.colorToken && attributes.colorToken !== "default"
                ? { "data-color-token": attributes.colorToken }
                : {}
          },
          customColor: {
            default: "",
            parseHTML: (element) => element.getAttribute("data-custom-color") || "",
            renderHTML: (attributes) =>
              attributes.customColor
                ? {
                    "data-custom-color": attributes.customColor,
                    style: `--node-accent: ${attributes.customColor}; color: ${attributes.customColor};`
                  }
                : {}
          }
        }
      }
    ];
  }
});

export function getCurrentBlockFormat(editor: Editor | null): BlockFormat {
  if (!editor) {
    return {
      textRole: "body",
      focusMode: false,
      cardMode: false,
      colorToken: "default",
      customColor: ""
    };
  }
  const attrs = editor.isActive("heading") ? editor.getAttributes("heading") : editor.getAttributes("paragraph");
  return {
    textRole: (attrs.textRole as TextRole | undefined) ?? "body",
    focusMode: Boolean(attrs.focusMode),
    cardMode: Boolean(attrs.cardMode),
    colorToken: (attrs.colorToken as ColorToken | undefined) ?? "default",
    customColor: typeof attrs.customColor === "string" ? attrs.customColor : ""
  };
}
