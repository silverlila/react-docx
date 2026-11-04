export type TokenKind = "plain" | "comment" | "string" | "keyword" | "tag" | "attr" | "number" | "literal";
export type Token = { readonly kind: TokenKind; readonly text: string };

const KEYWORDS = new Set([
  "import",
  "from",
  "export",
  "default",
  "const",
  "let",
  "var",
  "return",
  "function",
  "async",
  "await",
  "new",
  "type",
  "typeof",
  "readonly",
]);
const LITERALS = new Set(["true", "false", "null", "undefined"]);
const DECLARES = new Set(["const", "let", "var", "type"]);

const PATTERN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(<\/?)([A-Za-z][\w.]*)|([A-Za-z_$][\w$]*)(?=\s*=(?!=|>))|([A-Za-z_$][\w$]*)|(\d+(?:\.\d+)?)/g;

export function highlight(source: string): Token[] {
  const tokens: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) tokens[tokens.length - 1] = { kind, text: last.text + text };
    else if (text) tokens.push({ kind, text });
  };
  let at = 0;
  let previousWord = "";
  for (const m of source.matchAll(PATTERN)) {
    push("plain", source.slice(at, m.index));
    at = m.index + m[0].length;
    const [, comment, string, bracket, tag, attr, word, number] = m;
    if (comment) push("comment", comment);
    else if (string) push("string", string);
    else if (tag) {
      push("plain", bracket);
      push("tag", tag);
    } else if (attr) push(KEYWORDS.has(attr) ? "keyword" : "attr", attr);
    else if (word) push(KEYWORDS.has(word) ? "keyword" : LITERALS.has(word) ? "literal" : "plain", word);
    else if (number) push("number", number);
    previousWord = attr ?? word ?? "";
  }
  push("plain", source.slice(at));
  return tokens;
}
