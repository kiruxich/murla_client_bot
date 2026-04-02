#!/usr/bin/env python3
"""Удаляет вызовы draftMsg( <expr>, d|ctx.session.orderDraft ) из register.ts."""
from pathlib import Path


def skip_ws(s: str, i: int) -> int:
    while i < len(s) and s[i] in " \t\n\r":
        i += 1
    return i


def parse_first_arg(s: str, start: int) -> tuple[str, int]:
    """Возвращает (текст первого аргумента, индекс сразу после него)."""
    i = skip_ws(s, start)
    depth = 0
    str_ch = None  # ' " или `
    esc = False
    arg_start = i

    while i < len(s):
        c = s[i]
        if str_ch == "`":
            if esc:
                esc = False
                i += 1
                continue
            if c == "\\":
                esc = True
                i += 1
                continue
            if c == "`":
                str_ch = None
                i += 1
                continue
            if c == "$" and i + 1 < len(s) and s[i + 1] == "{":
                depth_brace = 1
                i += 2
                while i < len(s) and depth_brace:
                    if s[i] == "{":
                        depth_brace += 1
                    elif s[i] == "}":
                        depth_brace -= 1
                    i += 1
                continue
            i += 1
            continue
        if str_ch in ('"', "'"):
            if esc:
                esc = False
                i += 1
                continue
            if c == "\\":
                esc = True
                i += 1
                continue
            if c == str_ch:
                str_ch = None
            i += 1
            continue
        if str_ch is None:
            if c in ('"', "'"):
                str_ch = c
                i += 1
                continue
            if c == "`":
                str_ch = "`"
                i += 1
                continue
            if c == "(":
                depth += 1
                i += 1
                continue
            if c == "," and depth == 0:
                return s[arg_start:i], i
            if c == ")":
                if depth == 0:
                    return s[arg_start:i], i
                depth -= 1
                i += 1
                continue
            i += 1
            continue
        i += 1
    return s[arg_start:i], i


def main() -> None:
    path = Path(__file__).resolve().parent.parent / "src" / "bot" / "register.ts"
    s = path.read_text(encoding="utf8")
    out: list[str] = []
    i = 0
    while i < len(s):
        if s.startswith("draftMsg(", i):
            j = i + len("draftMsg(")
            arg_text, j = parse_first_arg(s, j)
            j = skip_ws(s, j)
            if j >= len(s) or s[j] != ",":
                out.append(s[i])
                i += 1
                continue
            j += 1
            j = skip_ws(s, j)
            # второй аргумент: d или ctx.session.orderDraft; допускается хвостовая запятая перед )
            if j < len(s) and s[j] == "d":
                j += 1
            elif s.startswith("ctx.session.orderDraft", j):
                j += len("ctx.session.orderDraft")
            else:
                out.append(s[i])
                i += 1
                continue
            j = skip_ws(s, j)
            if j < len(s) and s[j] == ",":
                j += 1
            j = skip_ws(s, j)
            if j < len(s) and s[j] == ")":
                j += 1
            else:
                out.append(s[i])
                i += 1
                continue
            out.append(arg_text)
            i = j
            continue
        out.append(s[i])
        i += 1
    path.write_text("".join(out), encoding="utf8")
    print("strip_draft_msg: OK")


if __name__ == "__main__":
    main()
