/**
 * Tool vocabulary: how each tool describes itself (a label and its details).
 *
 * Pure and deterministic — no components, no theme, no globals. Which tools get
 * compacted is `Config.compacts()`, not this file.
 *
 * `describeTool` returns the label and details SEPARATELY and must never join
 * them: the painter colors each part, and one joined string would
 * force it to split on the first space, assuming no label contains one.
 */

/** Native tools with a per-tool details extractor below. */
// `as const` preserves literal names instead of widening every item to string.
export const BUILT_INS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

// `(typeof BUILT_INS)[number]` turns the tuple values into a union type.
export type ToolName = (typeof BUILT_INS)[number];

/** True for native tools with a hand-written description. */
export function isBuiltIn(name: string): name is ToolName {
  return BUILT_INS.includes(name as ToolName);
}

/** MCP tools discovered from their registering extension's source metadata. */
const mcpTools = new Set<string>();

/**
 * Refresh after MCP adapter registration.
 *
 * Decides what gets LABELED `mcp` (not what gets compacted; the blacklist does
 * that). It is real information: a bare
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

/**
 * Collapse whitespace and truncate for one-line display.
 *
 * `max` is a DISPLAY budget in characters. It is not the final word on width —
 * `CompactLine` truncates at the real viewport column count. There is no other
 * cap: with no budget the whole value is kept.
 */
export function compact(value: unknown, max = Number.POSITIVE_INFINITY): string {
  const raw = String(value ?? "");
  // With a finite budget, slice BEFORE the regex so a huge string is never fully
  // scanned for a collapsed row. The extra headroom leaves room for whitespace
  // runs that collapse away.
  const sliced = Number.isFinite(max) ? raw.slice(0, max * 2 + 16) : raw;
  // Replacing every whitespace run prevents multi-line call rows.
  const text = sliced.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The value for an EXPANDED row: complete, with its line structure kept.
 * `\r\n` becomes `\n`, tabs become two spaces, trailing whitespace goes, and
 * blank lines at the start and end of the whole value go. Each line keeps its
 * own leading indentation; `CompactLine` wraps every line under the details.
 */
export function block(value: unknown): string {
  const lines = String(value ?? "")
    // \v, \f, \u2028, \u2029 and \u0085 would reach the terminal raw (the
    // collapsed path folds them away with \s+).
    .replace(/[\v\f\u2028\u2029\u0085]/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, "  ").trimEnd());
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/** A budget means a collapsed one-line row; no budget means an expanded row. */
function field(value: unknown, budget: number): string {
  return Number.isFinite(budget) ? compact(value, budget) : block(value);
}

/** Minimum columns a composed field keeps, so it never vanishes entirely. */
const MIN_FIELD = 12;

export type DescribeOptions = {
  /**
   * Columns available for the details segment.
   *
   * Approximate on purpose: `CompactLine` performs the exact, ANSI-aware,
   * wide-character-aware truncation. This budget only decides WHICH field is
   * sacrificed when a composed detail (`/pattern/ in path`) cannot fit.
   * Omitted (expanded rows): full-length details, wrapped by `CompactLine`.
   */
  budget?: number;
};

/**
 * The description of a call: `read` + `src/a.ts:1-50`, `bash` +
 * `go test ./...`, or a third-party tool's name plus its most identifying
 * argument.
 */
export function describeTool(name: string, args: any, options: DescribeOptions = {}): { label: string; details: string } {
  const budget = options.budget ?? Number.POSITIVE_INFINITY;
  const a = args ?? {};

  if (name === "mcp") return { label: "mcp", details: mcpDetails(a, budget) };
  if (name === "mcpScript") return { label: "mcpScript", details: field(a.code, budget) };
  if (name.startsWith("mcp__")) {
    const server = name.slice("mcp__".length);
    const tool = field(a.tool, budget);
    return { label: "mcp", details: tool ? `${tool} @ ${server}` : `@ ${server}` };
  }
  if (isMcpTool(name)) return { label: "mcp", details: name };
  if (isBuiltIn(name)) return { label: name, details: builtInDetails(name, a, options) };
  // Any other tool: show the name plus whichever argument identifies the call.
  return { label: name, details: genericDetails(a, budget) };
}

/**
 * Name shown in a folded run summary: the concrete operation, never a category.
 *
 * `mcp` rows label themselves `mcp` for readability, but a summary of five
 * different MCP calls reading `mcp ×5` would hide which servers were touched.
 */
export function summaryName(name: string, args: any): string {
  if (isBuiltIn(name) || name === "mcpScript") return name;
  if (name === "mcp") return compact(args?.tool) || "mcp";
  if (name.startsWith("mcp__")) {
    const tool = compact(args?.tool);
    return tool ? `${tool} @ ${name.slice("mcp__".length)}` : name;
  }
  return name;
}

function mcpDetails(args: any, budget: number): string {
  if (args.tool) return field(args.tool, budget);
  for (const key of ["search", "describe", "connect", "action"] as const) {
    if (args[key]) return `${key} ${field(args[key], budget)}`;
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

function genericDetails(args: any, budget: number): string {
  for (const key of GENERIC_KEYS) {
    const value = args[key];
    // Only scalars: an object would serialize into noise on a row.
    if (value !== undefined && value !== null && typeof value !== "object") {
      const text = field(value, budget);
      if (text) return text;
    }
  }
  return "";
}

function builtInDetails(name: ToolName, args: any, options: DescribeOptions): string {
  const budget = options.budget ?? Number.POSITIVE_INFINITY;
  // Paths are shown verbatim (no ~/ home abbreviation — it was decorative and
  // cost a homedir() call per render).
  const path = (value: unknown) => String(value ?? "");

  switch (name) {
    case "bash":
      // ONE field, so no budget split is needed: CompactLine truncates at the
      // real viewport width (no character cap). A collapsed row folds newlines into spaces; an expanded one
      // keeps its lines (see `field`).
      return field(args.command, budget);
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
      const pattern = field(args.pattern, room);
      return name === "grep" ? `/${pattern}/ in ${where}` : `${pattern} in ${where}`;
    }
    case "ls":
      return path(args.path ?? ".");
  }
}
