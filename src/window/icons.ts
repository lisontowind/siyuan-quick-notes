// Lucide 0.468.0; ISC and Feather MIT notices in THIRD_PARTY_NOTICES.md.
const paths: Record<string, string> = {
  "bold": "<path d=\"M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8\" />",
  "italic": "<line x1=\"19\" x2=\"10\" y1=\"4\" y2=\"4\" />\n  <line x1=\"14\" x2=\"5\" y1=\"20\" y2=\"20\" />\n  <line x1=\"15\" x2=\"9\" y1=\"4\" y2=\"20\" />",
  "underline": "<path d=\"M6 4v6a6 6 0 0 0 12 0V4\" />\n  <line x1=\"4\" x2=\"20\" y1=\"20\" y2=\"20\" />",
  "strikethrough": "<path d=\"M16 4H9a3 3 0 0 0-2.83 4\" />\n  <path d=\"M14 12a4 4 0 0 1 0 8H6\" />\n  <line x1=\"4\" x2=\"20\" y1=\"12\" y2=\"12\" />",
  "heading": "<path d=\"M6 12h12\" />\n  <path d=\"M6 20V4\" />\n  <path d=\"M18 20V4\" />",
  "list": "<path d=\"M3 12h.01\" />\n  <path d=\"M3 18h.01\" />\n  <path d=\"M3 6h.01\" />\n  <path d=\"M8 12h13\" />\n  <path d=\"M8 18h13\" />\n  <path d=\"M8 6h13\" />",
  "list-ordered": "<path d=\"M10 12h11\" />\n  <path d=\"M10 18h11\" />\n  <path d=\"M10 6h11\" />\n  <path d=\"M4 10h2\" />\n  <path d=\"M4 6h1v4\" />\n  <path d=\"M6 18H4c0-1 2-2 2-3s-1-1.5-2-1\" />",
  "list-todo": "<rect x=\"3\" y=\"5\" width=\"6\" height=\"6\" rx=\"1\" />\n  <path d=\"m3 17 2 2 4-4\" />\n  <path d=\"M13 6h8\" />\n  <path d=\"M13 12h8\" />\n  <path d=\"M13 18h8\" />",
  "quote": "<path d=\"M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z\" />\n  <path d=\"M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z\" />",
  "code": "<polyline points=\"16 18 22 12 16 6\" />\n  <polyline points=\"8 6 2 12 8 18\" />",
  "link": "<path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\" />\n  <path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\" />",
  "image": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\" />\n  <circle cx=\"9\" cy=\"9\" r=\"2\" />\n  <path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" />",
  "plus": "<path d=\"M5 12h14\" />\n  <path d=\"M12 5v14\" />",
  "arrow-up-right": "<path d=\"M7 7h10v10\" />\n  <path d=\"M7 17 17 7\" />",
  "pin": "<path d=\"M12 17v5\" />\n  <path d=\"M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z\" />",
  "ellipsis": "<circle cx=\"12\" cy=\"12\" r=\"1\" />\n  <circle cx=\"19\" cy=\"12\" r=\"1\" />\n  <circle cx=\"5\" cy=\"12\" r=\"1\" />",
  "minus": "<path d=\"M5 12h14\" />",
  "x": "<path d=\"M18 6 6 18\" />\n  <path d=\"m6 6 12 12\" />",
  "arrow-left": "<path d=\"m12 19-7-7 7-7\" />\n  <path d=\"M19 12H5\" />",
  "settings": "<path d=\"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z\" />\n  <circle cx=\"12\" cy=\"12\" r=\"3\" />",
  "keyboard": "<path d=\"M10 8h.01\" />\n  <path d=\"M12 12h.01\" />\n  <path d=\"M14 8h.01\" />\n  <path d=\"M16 12h.01\" />\n  <path d=\"M18 8h.01\" />\n  <path d=\"M6 8h.01\" />\n  <path d=\"M7 16h10\" />\n  <path d=\"M8 12h.01\" />\n  <rect width=\"20\" height=\"16\" x=\"2\" y=\"4\" rx=\"2\" />",
  "code-xml": "<path d=\"m18 16 4-4-4-4\" />\n  <path d=\"m6 8-4 4 4 4\" />\n  <path d=\"m14.5 4-5 16\" />",
  "chevron-left": "<path d=\"m15 18-6-6 6-6\" />",
  "chevron-right": "<path d=\"m9 18 6-6-6-6\" />",
  "grip-vertical": "<circle cx=\"9\" cy=\"12\" r=\"1\" />\n  <circle cx=\"9\" cy=\"5\" r=\"1\" />\n  <circle cx=\"9\" cy=\"19\" r=\"1\" />\n  <circle cx=\"15\" cy=\"12\" r=\"1\" />\n  <circle cx=\"15\" cy=\"5\" r=\"1\" />\n  <circle cx=\"15\" cy=\"19\" r=\"1\" />"
};
export function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths[name] ?? paths['ellipsis'];
  return svg;
}
export function windowIcons(): void {
  const names: Record<string, string> = { new: 'plus', open: 'arrow-up-right', pin: 'pin', more: 'ellipsis', minimize: 'minus', close: 'x', back: 'arrow-left', settings: 'settings', 'render-mode': 'code-xml', 'toolbar-toggle': 'keyboard', 'callout-type': 'quote' };
  for (const [id, name] of Object.entries(names)) document.getElementById(id)?.replaceChildren(icon(name));
}
