/** The two native file paths an import writes into text where a legacy storage URL was (media-urls.ts): a conversation's
 * file, `/api/conversations/<conversation>/media/<file>`, and an imported workspace file,
 * `/api/imported-files/<workspace>/<file>`. Any other path in text is the writer's own and is never touched. The stored
 * text holds the bare path; the renderers link it when they show it, since Markdown links only absolute URLs. */
const segment = "[^\\s/<>\"'`()[\\]{}|\\\\^]";
/** Each native file path in text, with the character before it (or none at the start) and without trailing sentence
 * punctuation, as a Markdown autolink reads a URL. Groups: 1 the preceding character, 2 the path. */
export const nativeFilePaths = () => new RegExp(`(^|[\\s(<"'[])(/api/(?:conversations/${segment}+/media|imported-files/${segment}+)/${segment}+?)(?=[.,;:!?]*(?:$|[\\s<>"'\`()[\\]{}|\\\\^]))`, 'g');

/** A remark plugin: a native file path written bare in a text node becomes a link to itself. Links, images and code are
 * left as they are. */
export function remarkNativeFileLinks() {
  const visit = node => {
    if (!Array.isArray(node.children) || node.type === 'link' || node.type === 'linkReference') return;
    node.children = node.children.flatMap(child => {
      if (child.type !== 'text') { visit(child); return [child]; }
      const parts = []; let last = 0;
      for (const match of child.value.matchAll(nativeFilePaths())) {
        const start = match.index + match[1].length;
        if (start > last) parts.push({type: 'text', value: child.value.slice(last, start)});
        parts.push({type: 'link', url: match[2], children: [{type: 'text', value: match[2]}]});
        last = start + match[2].length;
      }
      if (!parts.length) return [child];
      if (last < child.value.length) parts.push({type: 'text', value: child.value.slice(last)});
      return parts;
    });
  };
  return tree => visit(tree);
}
