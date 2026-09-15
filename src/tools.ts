/**
 * Tool vocabulary: which tools we compact, and how each one describes itself on
 * one line. Pure and deterministic — no components, no theme, no globals.
 *
 * describeTool returns the label and details SEPARATELY. It must never join
 * them: the painter (row.ts) colors each part, and an earlier version that
 * returned one string forced the painter to split it back apart on the first
 * space, silently assuming no label ever contains one.
 */

/** Every native tool whose RENDERING (never its definition) we replace. */
// `as const` preserves literal names instead of widening every item to string.
export const BUILT_INS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

// `(typeof BUILT_INS)[number]` turns the tuple values into a union type.
export type ToolName = (typeof BUILT_INS)[number];

/** True for native tools whose rendering (only) we replace. */
export function isBuiltIn(name: string): name is ToolName {
  return BUILT_INS.includes(name as ToolName);
}

/** MCP tools discovered from their registering extension's source metadata. */
const mcpTools = new Set<string>();

/** Refresh after MCP adapter registration; direct tool names are configuration-dependent. */
export function refreshMcpTools(tools: { name: string; sourceInfo: { path: string } }[]): void {
  mcpTools.clear();
  for (const tool of tools) {
    if (tool.sourceInfo.path.includes("pi-mcp-adapter")) mcpTools.add(tool.name);
  }
}

export function isMcpTool(name: string): boolean {
  return name === "mcp" || name === "mcpScript" || name.startsWith("mcp__") || mcpTools.has(name);
}

/** Native tools plus MCP tools; rendererless tools reach us through fallback. */
export function isCompactTool(name: string): boolean {
  return isBuiltIn(name) || isMcpTool(name);
}

/** Collapse whitespace and truncate long values for one-line display. */
export function compact(value: unknown, max = 100): string {
  // Replacing every whitespace run prevents multi-line call rows.
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The one-line description of a call: `read` + `src/a.ts:1-50`, `bash` +
 * `go test ./...`, or a rendererless tool's registered name.
 */
export function describeTool(name: string, args: any, expanded = false): { label: string; details: string } {
  if (name === "mcp") return { label: "mcp", details: mcpDetails(args ?? {}) };
  if (name === "mcpScript") return { label: "mcpScript", details: compact(args?.code) };
  if (name.startsWith("mcp__")) {
    const server = name.slice("mcp__".length);
    const tool = compact(args?.tool);
    return { label: "mcp", details: tool ? `${tool} @ ${server}` : `@ ${server}` };
  }
  if (isMcpTool(name)) return { label: "mcp", details: name };
  if (!isBuiltIn(name)) return { label: name, details: "" };
  return { label: name, details: toolDetails(name, args ?? {}, expanded) };
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

function mcpDetails(args: any): string {
  if (args.tool) return compact(args.tool);
  for (const key of ["search", "describe", "connect", "action"] as const) {
    if (args[key]) return `${key} ${compact(args[key])}`;
  }
  return "";
}

function toolDetails(name: ToolName, args: any, expanded: boolean): string {
  // Paths are shown verbatim (no ~/ home abbreviation — it was decorative and
  // cost a homedir() call per render).
  const path = (value: unknown) => String(value ?? "");
  switch (name) {
    case "bash":
      // Collapsed rows truncate at 100 chars. Expanded rows keep the full
      // command LENGTH but still collapse newlines into ONE physical line;
      // otherwise a multiline heredoc escapes the call-row gutter and merges
      // with the expanded output below it. CompactLine then clips at the real
      // terminal width.
      return compact(args.command, expanded ? Number.POSITIVE_INFINITY : 100);
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
      return `/${compact(args.pattern, 50)}/ in ${path(args.path ?? ".")}`;
    case "find":
      return `${compact(args.pattern, 50)} in ${path(args.path ?? ".")}`;
    case "ls":
      return path(args.path ?? ".");
  }
}
