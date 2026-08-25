export function keepEditorFocus(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

export function HighlightedText({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let index = 0;
  let match = lower.indexOf(keyword);
  while (match >= 0) {
    if (match > index) parts.push(text.slice(index, match));
    parts.push(
      <mark key={`${match}-${keyword}`} className="search-hit">
        {text.slice(match, match + keyword.length)}
      </mark>
    );
    index = match + keyword.length;
    match = lower.indexOf(keyword, index);
  }
  if (index < text.length) parts.push(text.slice(index));
  return <>{parts}</>;
}
