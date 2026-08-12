/**
 * Python docstring extent counter (size lane adjuster)
 *
 * scc treats only `#` as a Python comment, so docstrings — including
 * blank lines inside them — land in the code column, silently moving
 * well-documented files across tier boundaries (pygmalion beta
 * finding 4). `ast` is the exact answer: one python3 child computes the
 * line extent of every real docstring (module/class/function first
 * statement). Soft-skips with a null when python3 is unavailable; the
 * lane discloses the gap instead of guessing.
 */

import { spawnSync } from "node:child_process";

const COUNTER_SCRIPT = `
import ast, json, sys
out = {}
for path in sys.stdin.buffer.read().decode("utf-8").split("\\0"):
    if not path:
        continue
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            tree = ast.parse(f.read())
    except (SyntaxError, OSError, ValueError):
        continue
    total = 0
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", None)
        if not body:
            continue
        first = body[0]
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
            and first.end_lineno is not None
        ):
            total += first.end_lineno - first.lineno + 1
    out[path] = total
json.dump(out, sys.stdout)
`;

/**
 * Docstring line extents per repo-relative Python file. Null when
 * python3 is missing or the helper fails — callers keep raw scc counts
 * and disclose. Unparseable files are simply absent (raw counts kept).
 */
export function countDocstringLines(
  rootPath: string,
  pyFiles: string[],
): Map<string, number> | null {
  if (pyFiles.length === 0) return new Map();
  const run = spawnSync("python3", ["-c", COUNTER_SCRIPT], {
    cwd: rootPath,
    input: pyFiles.join("\0"),
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
  });
  if (run.error || run.status !== 0 || !run.stdout) return null;
  try {
    const parsed = JSON.parse(run.stdout) as Record<string, number>;
    return new Map(Object.entries(parsed));
  } catch {
    return null;
  }
}
