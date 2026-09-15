/**
 * Tool vocabulary: which tools we compact, and how each one describes itself on
 * one line. Pure and deterministic — no components, no theme, no globals.
 *
 * describeTool returns the label and details SEPARATELY. It must never join
 * them: the painter (row.ts) colors each part, and an earlier version that
 * returned one string forced the painter to split it back apart on the first
 * space, silently assuming no label ever contains one.
 *
 * CLAIMING IS A BLACKLIST. Every tool is compacted unless it is named in
 * `excludeTools`. The old rule ("built-ins + MCP, plus anything with no renderer
 * of its own") silently exempted every third-party tool that shipped a renderer,
 * which was impossible to discover from the UI: `subagent` stayed a big card and
 * nothing explained why. Now the exemption list is data the user can see and
 * edit.
 */

import type { Config } from "./config.ts";

/** Native tools with a per-tool details extractor below. */
// `as const` preserves literal names instead of widening every item to string.
export const BUILT_INS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

// `(typeof BUILT_INS)[number]` turns the tuple values into a union type.
export type ToolName = (typeof BUILT_INS)[number];

/** True for native tools with a hand-written one-line description. */
export function isBuiltIn(name: string): name is ToolName {
  return BUILT_INS.includes(name as ToolName);
}

/** MCP tools discovered from their registering extension's source metadata. */
const mcpTools = new Set<string>();

/**
 * Refresh after MCP adapter registration.
 *
 * No longer decides what gets COMPACTED (the blacklist does that). It is kept
 * because it decides what gets LABELED `mcp`, which is real information: a bare
 * `atlassian_getConfluencePage` row does not tell you it crossed an MCP server.
 */
export function refreshMcpTools(tools: { name: string; sourceInfo: { path: string } }[]): void {
  mcpTools.clear();
  for (const tool of tools) {
    if (tool.sourceInfo.path.includes("pi-mcp-adapter")) mcpTools.add(tool.name);
  }
}

export function isMcpTool(name: string): boolean {
  return name === "mcp" || name === "mcpScript" || name.startsWith("mcp__") || mcpTools.has(name);
}

/** Blacklist test: everything compacts unless the user excluded it. */
export function isCompactTool(name: string, config: Config): boolean {
  return !config.isExcluded(name);
}

/**
 * Collapse whitespace and truncate for one-line display.
 *
 * `max` is a DISPLAY budget in characters; `hardCap` is a sanity limit that
 * exists only so a multi-megabyte heredoc is not whitespace-collapsed, colored
 * and measured on every repaint. Neither is the final word on width —
 * `CompactLine` truncates at the real viewport column count.
 */
export function compact(value: unknown, max = Number.POSITIVE_INFINITY, hardCap = 4000): string {
  const limit = Math.min(max, hardCap);
  // Slice BEFORE the regex so a huge string is never fully scanned. The extra
  // headroom leaves room for whitespace runs that collapse away.
  const raw = String(value ?? "");
  const sliced = Number.isFinite(limit) ? raw.slice(0, limit * 2 + 16) : raw.slice(0, hardCap * 2 + 16);
  // Replacing every whitespace run prevents multi-line call rows.
  const text = sliced.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Minimum columns a composed field keeps, so it never vanishes entirely. */
const MIN_FIELD = 12;

export type DescribeOptions = {
  /** Expanded rows keep full-length details (still on ONE physical line). */
  expanded?: boolean;
  /**
   * Columns available for the details segment.
   *
   * Approximate on purpose: `CompactLine` performs the exact, ANSI-aware,
   * wide-character-aware truncation. This budget only decides WHICH field is
   * sacrificed when a composed detail (`/pattern/ in path`) cannot fit.
   */
  budget?: number;
  config?: Config;
};

/**
 * The one-line description of a call: `read` + `src/a.ts:1-50`, `bash` +
 * `go test ./...`, or a third-party tool's name plus its most identifying
 * argument.
 */
export function describeTool(name: string, args: any, options: DescribeOptions = {}): { label: string; details: string } {
  const hardCap = options.config?.get("maxDetailChars") ?? 4000;
  const budget = options.budget ?? Number.POSITIVE_INFINITY;
  const a = args ?? {};

  if (name === "mcp") return { label: "mcp", details: mcpDetails(a, budget, hardCap) };
  if (name === "mcpScript") return { label: "mcpScript", details: compact(a.code, budget, hardCap) };
  if (name.startsWith("mcp__")) {
    const server = name.slice("mcp__".length);
    const tool = compact(a.tool, budget, hardCap);
    return { label: "mcp", details: tool ? `${tool} @ ${server}` : `@ ${server}` };
  }
  if (isMcpTool(name)) return { label: "mcp", details: name };
  if (isBuiltIn(name)) return { label: name, details: builtInDetails(name, a, options, hardCap) };
  // Any other tool: show the name plus whichever argument identifies the call.
  return { label: name, details: genericDetails(a, budget, hardCap) };
}

/** Name shown in /quiet summaries: operation name, never a generic category. */
export function quietToolName(name: string, args: any): string {
  if (isBuiltIn(name) || name === "mcpScript") return name;
  if (name === "mcp") return compact(args?.tool) || "mcp";
  if (name.startsWith("mcp__")) {
    const tool = compact(args?.tool);
    return tool ? `${tool} @ ${name.slice("mcp__".length)}` : name;
  }
  return name;
}

function mcpDetails(args: any, budget: number, hardCap: number): string {
  if (args.tool) return compact(args.tool, budget, hardCap);
  for (const key of ["search", "describe", "connect", "action"] as const) {
    if (args[key]) return `${key} ${compact(args[key], budget, hardCap)}`;
  }
  return "";
}

/**
 * Argument keys worth showing for a tool we know nothing about, most
 * identifying first. Without this a blacklist default would render every
 * third-party tool as a bare name, which is less information than Pi's own
 * verbose card — the compaction would be a downgrade rather than a cleanup.
 */
const GENERIC_KEYS = [
  "command", "path", "file", "filePath", "pattern", "query", "url", "name",
  "tool", "action", "id", "target", "message", "text", "prompt",
] as const;

function genericDetails(args: any, budget: number, hardCap: number): string {
  for (const key of GENERIC_KEYS) {
    const value = args[key];
    // Only scalars: an object would serialize into noise on a one-line row.
    if (value !== undefined && value !== null && typeof value !== "object") {
      const text = compact(value, budget, hardCap);
      if (text) return text;
    }
  }
  return "";
}

function builtInDetails(name: ToolName, args: any, options: DescribeOptions, hardCap: number): string {
  const expanded = options.expanded === true;
  const budget = options.budget ?? Number.POSITIVE_INFINITY;
  // Paths are shown verbatim (no ~/ home abbreviation — it was decorative and
  // cost a homedir() call per render).
  const path = (value: unknown) => String(value ?? "");

  switch (name) {
    case "bash":
      // ONE field, so no budget split is needed: CompactLine truncates at the
      // real viewport width. An earlier version also capped this at 100
      // characters, which threw away ~89 usable columns on a 200-column
      // terminal. Newlines still collapse so a heredoc cannot escape the row.
      return compact(args.command, expanded ? Number.POSITIVE_INFINITY : budget, hardCap);
    case "read": {
      // Show the line range when offset/limit were used, mirroring the built-in
      // read tool's "path:start-end" notation.
      const start = args.offset ?? 1;
      const range = args.offset !== undefined || args.limit !== undefined
        ? `:${start}${args.limit ? `-${start + args.limit - 1}` : ""}`
        : "";
      return `${path(args.path)}${range}`;
    }
    case "edit":
    case "write":
      return path(args.path);
    case "grep":
    case "find": {
      // COMPOSED detail: two fields competing for one row. The path identifies
      // the search, so it keeps its columns and the pattern takes the rest;
      // otherwise a long regex pushed the path off the end of the line.
      const where = path(args.path ?? ".");
      const wrapper = name === "grep" ? 2 : 0; // the two slashes in /pattern/
      const overhead = where.length + " in ".length + wrapper;
      const room = Number.isFinite(budget) ? Math.max(MIN_FIELD, budget - overhead) : Number.POSITIVE_INFINITY;
      const pattern = compact(args.pattern, room, hardCap);
      return name === "grep" ? `/${pattern}/ in ${where}` : `${pattern} in ${where}`;
    }
    case "ls":
      return path(args.path ?? ".");
  }
}
