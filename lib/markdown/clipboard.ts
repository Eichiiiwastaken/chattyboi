const SEMANTIC_HTML_PATTERN =
  /<(?:h[1-6]|p|ol|ul|li|strong|b|em|i|pre|code|math)\b/i;

/**
 * Cleans up Markdown copied from rendered chat responses. Some chat clients put
 * list-shaped Markdown inside a single pair of backticks and separate ordered
 * list markers from their text with blank lines.
 */
export function normalizePastedMarkdown(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
    .replace(
      /(^|\n)([ \t]*)`((?:[-+*]|\d+\.)\s+[\s\S]*?)`(?=[ \t]*(?:\n|$))/g,
      (_match, lineStart: string, indentation: string, list: string) =>
        lineStart +
        indentation +
        list.replace(/\s+(-\s+)(?=(?:\*\*|__))/g, "\n$1")
    )
    .replace(
      /^([ \t]*)(\d+\.)[ \t]*\n(?:[ \t]*\n)+[ \t]*(\S[^\n]*)/gm,
      "$1$2 $3"
    );
}

export function markdownFromClipboard(html: string, plainText: string) {
  const normalizedPlainText = normalizePastedMarkdown(plainText);

  if (
    !html ||
    !SEMANTIC_HTML_PATTERN.test(html) ||
    typeof DOMParser === "undefined"
  ) {
    return normalizedPlainText;
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  const markdown = serializeChildren(document.body).trim();

  // Avoid replacing useful clipboard text with an empty wrapper or a tiny
  // fragment produced by browser extensions.
  if (
    !markdown ||
    markdown.replace(/\s/g, "").length <
      normalizedPlainText.replace(/\s/g, "").length * 0.5
  ) {
    return normalizedPlainText;
  }

  return normalizePastedMarkdown(markdown)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function serializeChildren(element: Element) {
  return Array.from(element.childNodes, serializeNode).join("");
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").replace(/\s+/g, " ");
  }

  if (!(node instanceof Element)) {
    return "";
  }

  const tagName = node.tagName.toLowerCase();

  if (["script", "style", "button", "svg"].includes(tagName)) {
    return "";
  }

  const tex = node
    .querySelector('annotation[encoding="application/x-tex"]')
    ?.textContent?.trim();
  if (
    tex &&
    (node.classList.contains("katex") ||
      tagName === "math" ||
      node.querySelector("math"))
  ) {
    const isDisplay =
      node.classList.contains("katex-display") ||
      node.closest(".katex-display") !== null;
    return isDisplay ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
  }

  if (tagName === "br") {
    return "\n";
  }

  if (tagName === "ul" || tagName === "ol") {
    return serializeList(node, 0);
  }

  const content = serializeChildren(node);

  if (tagName === "strong" || tagName === "b") {
    return content.trim() ? `**${content.trim()}**` : "";
  }
  if (tagName === "em" || tagName === "i") {
    return content.trim() ? `*${content.trim()}*` : "";
  }
  if (tagName === "code" && node.parentElement?.tagName !== "PRE") {
    return content ? `\`${content}\`` : "";
  }
  if (tagName === "pre") {
    return `\n\n\`\`\`\n${node.textContent?.trimEnd() ?? ""}\n\`\`\`\n\n`;
  }
  if (/^h[1-6]$/.test(tagName)) {
    return `\n\n${"#".repeat(Number(tagName[1]))} ${content.trim()}\n\n`;
  }
  if (tagName === "p") {
    return content.trim() ? `${content.trim()}\n\n` : "";
  }
  if (tagName === "blockquote") {
    return `\n\n${content
      .trim()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}\n\n`;
  }
  if (tagName === "a") {
    const href = node.getAttribute("href");
    return href && content.trim() ? `[${content.trim()}](${href})` : content;
  }
  if (tagName === "div" || tagName === "section" || tagName === "article") {
    return content.trim() ? `${content.trim()}\n` : "";
  }

  return content;
}

function serializeList(list: Element, depth: number): string {
  const ordered = list.tagName.toLowerCase() === "ol";
  const start = Number(list.getAttribute("start") ?? 1);
  const items = Array.from(list.children).filter(
    (child) => child.tagName.toLowerCase() === "li"
  );

  const lines = items.map((item, index) => {
    const nestedLists = Array.from(item.children).filter((child) =>
      ["ol", "ul"].includes(child.tagName.toLowerCase())
    );
    const nestedSet = new Set(nestedLists);
    const content = Array.from(item.childNodes)
      .filter((child) => !(child instanceof Element && nestedSet.has(child)))
      .map(serializeNode)
      .join("")
      .trim()
      .replace(/\n{2,}/g, "\n");
    const indentation = "   ".repeat(depth);
    const marker = ordered ? `${start + index}.` : "-";
    const nested = nestedLists
      .map((child) => serializeList(child, depth + 1))
      .join("");

    return `${indentation}${marker} ${content}\n${nested}`;
  });

  return `${lines.join("")}\n`;
}
