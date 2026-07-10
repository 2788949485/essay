export const BLOCK_MATH = /\$\$(?!\s)([\s\S]+?)(?<!\s)\$\$/;
export const INLINE_MATH = /(?<!\$)\$(?!\$)(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/;
const LATEX_COMMAND = /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|lim|log|ln|exp|sin|cos|tan|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega|infty|cdot|times|pm|leq|geq|neq|approx|rightarrow|left|right)\b/;

export function isStandaloneLatex(text: string): boolean {
  const value = text.trim();
  return Boolean(value && LATEX_COMMAND.test(value) && /[=^_{}]/.test(value));
}

export type MathSegment =
  | { type: "text"; text: string }
  | { type: "math"; latex: string };

export function splitInlineMath(text: string): MathSegment[] {
  if (!text) return [];
  const segments: MathSegment[] = [];
  const re = new RegExp(INLINE_MATH.source, "g");
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) segments.push({ type: "text", text: text.slice(last, match.index) });
    segments.push({ type: "math", latex: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ type: "text", text: text.slice(last) });
  return segments;
}

export function hasInlineMath(text: string): boolean {
  return INLINE_MATH.test(text);
}
