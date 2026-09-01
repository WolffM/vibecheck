/**
 * vulture runner (dead-code lane substrate, Python)
 *
 * Single-source Python dead-code detection. The design's confidence rule
 * (Vulture ∪ Skylos, both-flagged = medium) applies its demotion in the
 * lane — this runner just reports what vulture saw at ≥60% confidence.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeRunFailure } from "./run-failure.js";

export interface VultureItem {
  path: string;
  line: number;
  confidence: number;
  /** e.g. "unused function 'render_pose'". */
  description: string;
}

export interface VultureResult {
  available: boolean;
  items: VultureItem[];
}

const LINE_PATTERN = /^(.+?):(\d+): (unused .+?) \((\d+)% confidence/;

/**
 * Decorators that ARE the consumer. Without these vulture reports every
 * registered handler as dead: on one repo that was 10 of 13 deadcode
 * firings, and a route module — which contains nothing but handlers —
 * scored a perfect 1.0 dead ratio (#382, #385). Deleting any of them
 * removes a live endpoint while CI stays green, so the asymmetry is
 * stark: a missed dead function costs nothing, a deleted live one is an
 * outage.
 */
const REGISTRATION_DECORATORS = [
  // web frameworks: Flask/Quart blueprints, aiohttp, FastAPI/Starlette
  "@*.route", "@*.get", "@*.post", "@*.put", "@*.patch", "@*.delete",
  "@*.head", "@*.options", "@*.websocket", "@*.middleware",
  "@*.errorhandler", "@*.before_request", "@*.after_request",
  "@*.before_app_request", "@*.on_event", "@*.exception_handler",
  // CLI: Click / Typer
  "@*.command", "@*.group", "@click.*", "@*.callback",
  // task queues and schedulers
  "@*.task", "@*.job", "@*.scheduled", "@*.periodic_task",
  // test framework magic
  "@pytest.*", "@*.fixture", "@*.hookimpl", "@*.parametrize",
  // property/observer registration
  "@*.setter", "@*.deleter", "@*.register", "@*.subscribe",
  "@*.listener", "@*.on", "@*.validator", "@*.field_validator",
  "@*.model_validator", "@*.root_validator", "@*.step",
];

/**
 * Module attributes frameworks read by name. `pytestmark` is the
 * canonical case: pytest reads it off the module, nothing ever
 * references it, by design.
 */
const FRAMEWORK_NAMES = [
  "pytestmark", "pytest_plugins", "conftest", "__all__",
  "setup_module", "teardown_module", "setup_function", "teardown_function",
];

/**
 * `for finder, module_name, is_pkg in pkgutil.iter_modules(...)` reports
 * the names you cannot avoid binding as unused variables (#385). You
 * cannot take the middle element of a tuple without naming the others,
 * so these are syntax, not dead code — and they inflated one file's
 * deadItems past its definitionCount, pushing the ratio above 1.0.
 */
export function isUnpackingThrowaway(
  description: string,
  source: string,
): boolean {
  const name = description.match(/unused variable '([^']+)'/)?.[1];
  if (!name) return false;
  const text = source.trim();
  // Loop unpacking: the name sits left of `in`, alongside a sibling.
  const forMatch = text.match(/^for\s+(.+?)\s+in\s/);
  if (forMatch && forMatch[1].includes(",")) {
    const targets = forMatch[1].split(",").map((t) => t.trim());
    if (targets.includes(name) && targets.length > 1) return true;
  }
  // Plain tuple assignment: `a, b = f()`.
  const assign = text.match(/^([\w\s,()*]+?)\s*=\s*[^=]/);
  if (assign && assign[1].includes(",")) {
    const targets = assign[1]
      .replace(/[()]/g, "")
      .split(",")
      .map((t) => t.trim().replace(/^\*/, ""));
    if (targets.includes(name) && targets.length > 1) return true;
  }
  return false;
}

export function runVulture(rootPath: string): VultureResult {
  // A bare `vulture` depends on pip's bin dir being on PATH — runner
  // environments routinely miss that while the module is importable, so
  // fall back to `python3 -m vulture`.
  let command = ["vulture"];
  const probe = spawnSync("vulture", ["--version"], {
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (probe.error || probe.status !== 0) {
    const moduleProbe = spawnSync("python3", ["-m", "vulture", "--version"], {
      encoding: "utf-8",
      stdio: "pipe",
    });
    if (moduleProbe.error || moduleProbe.status !== 0) {
      console.warn("vulture unavailable: neither on PATH nor importable by python3");
      return { available: false, items: [] };
    }
    command = ["python3", "-m", "vulture"];
  }

  const run = spawnSync(
    command[0],
    [
      ...command.slice(1),
      ".",
      "--min-confidence",
      "60",
      "--ignore-decorators",
      REGISTRATION_DECORATORS.join(","),
      "--ignore-names",
      FRAMEWORK_NAMES.join(","),
      "--exclude",
      "node_modules,vendor,build,dist,.venv,venv,__pycache__,migrations",
    ],
    {
      cwd: rootPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    },
  );
  // vulture exits 3 when it finds dead code — that is success with data.
  // `run.error` alone only catches a failure to SPAWN; vulture exiting non-zero
  // for a reason other than "found dead code" (exit 3) fell straight through
  // into the parse loop and reported zero items.
  if (run.error || (run.status !== 0 && run.status !== 3)) {
    console.warn(`vulture failed: ${describeRunFailure(run)}`);
    return { available: false, items: [] };
  }

  const items: VultureItem[] = [];
  const sourceCache = new Map<string, string[]>();
  const sourceLine = (relPath: string, lineNo: number): string => {
    let lines = sourceCache.get(relPath);
    if (!lines) {
      try {
        lines = readFileSync(join(rootPath, relPath), "utf-8").split("\n");
      } catch {
        lines = [];
      }
      sourceCache.set(relPath, lines);
    }
    return lines[lineNo - 1] ?? "";
  };

  for (const line of (run.stdout ?? "").split("\n")) {
    const match = line.match(LINE_PATTERN);
    if (!match) continue;
    const path = match[1].replace(/\\/g, "/").replace(/^\.\//, "");
    const lineNo = Number(match[2]);
    const description = match[3];
    if (isUnpackingThrowaway(description, sourceLine(path, lineNo))) continue;
    items.push({
      path,
      line: lineNo,
      description,
      confidence: Number(match[4]),
    });
  }
  return { available: true, items };
}
