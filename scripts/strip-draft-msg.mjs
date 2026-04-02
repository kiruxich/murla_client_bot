import fs from "node:fs";

const path = "src/bot/register.ts";
let s = fs.readFileSync(path, "utf8");

const skipWs = (i) => {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
};

/** Parse one expression starting at i; return [endExclusive, text]. Supports strings, templates, parens. */
const parseExpr = (start) => {
  let i = skipWs(start);
  const out = [];
  let depth = 0;
  let inStr = null;
  let esc = false;
  let tick = null; // ` template

  const pushUntil = (end) => {
    out.push(s.slice(start, end));
  };

  while (i < s.length) {
    const c = s[i];
    if (tick === "`") {
      out.push(c);
      if (esc) {
        esc = false;
        i++;
        continue;
      }
      if (c === "\\") {
        esc = true;
        i++;
        continue;
      }
      if (c === "`") {
        tick = null;
      }
      i++;
      continue;
    }
    if (inStr) {
      out.push(c);
      if (esc) {
        esc = false;
      } else if (c === "\\") {
        esc = true;
      } else if (c === inStr) {
        inStr = null;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      if (c === "`") tick = "`";
      else inStr = c;
      out.push(c);
      i++;
      continue;
    }
    if (c === "(") {
      depth++;
      out.push(c);
      i++;
      continue;
    }
    if (c === ")") {
      if (depth === 0) {
        return { end: i, text: s.slice(start, i) };
      }
      depth--;
      out.push(c);
      i++;
      continue;
    }
    out.push(c);
    i++;
  }
  return { end: i, text: s.slice(start, i) };
};

let out = "";
let i = 0;
while (i < s.length) {
  if (s.startsWith("draftMsg(", i)) {
    const afterOpen = i + "draftMsg(".length;
    const { end: argEnd, text: argText } = parseExpr(afterOpen);
    let j = skipWs(argEnd);
    if (s[j] !== ",") {
      out += s.slice(i, i + 1);
      i++;
      continue;
    }
    j++;
    j = skipWs(j);
    if (s.startsWith("d)", j) || s.startsWith("ctx.session.orderDraft)", j)) {
      const close = s.indexOf(")", j);
      if (close === -1) break;
      out += argText;
      i = close + 1;
      continue;
    }
  }
  out += s[i];
  i++;
}

fs.writeFileSync(path, out);
console.log("strip-draft-msg: OK");
