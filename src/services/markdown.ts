// Use the host's own Markdown engine without loading Protyle or executing generated HTML.
export interface MarkdownEngine {
  Md2BlockDOM(text: string): string; BlockDOM2StdMd(dom: string): string;
  SetSuperBlock(enabled: boolean): void; SetKramdownIAL(enabled: boolean): void;
  SetBlockRef?(enabled: boolean): void; SetTag?(enabled: boolean): void;
  SetCallout?(enabled: boolean): void; SetInlineMath?(enabled: boolean): void;
}
export function createMarkdownNormalizer(engine: MarkdownEngine): (text: string) => string {
  engine.SetSuperBlock(true); engine.SetKramdownIAL(true);
  engine.SetBlockRef?.(true); engine.SetTag?.(true); engine.SetCallout?.(true); engine.SetInlineMath?.(true);
  const normalizeRegion = (text: string): string => {
    const dom = engine.Md2BlockDOM(text);
    const markdown = engine.BlockDOM2StdMd(dom);
    if (typeof dom !== 'string' || typeof markdown !== 'string') throw new Error('宿主 Markdown 内容核对失败');
    return markdown.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
  };
  return text => {
    // Standard Markdown omits superblock layout. Preserve boundaries and the body inside each region.
    const structure: string[] = [];
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let regionStart = 0;
    let fence = '';
    for (const [index, line] of lines.entries()) {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*(`+|~+)\s*$/.test(line)) fence = '';
        continue;
      }
      if (fence) continue;
      const block = /^\{\{\{(row|col)?\s*$/.exec(line);
      const end = /^\}\}\}\s*$/.test(line);
      if (block || end) {
        structure.push(normalizeRegion(lines.slice(regionStart, index).join('\n')), block ? block[1] || 'col' : 'end');
        regionStart = index + 1;
      }
    }
    if (structure.length) { structure.push(normalizeRegion(lines.slice(regionStart).join('\n'))); return JSON.stringify(structure); }
    return JSON.stringify([normalizeRegion(text)]);
  };
}
