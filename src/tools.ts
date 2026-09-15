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

/** Generic label for third-party/MCP tools that ship no renderer of their own. */
export const FALLBACK_LABEL = "toolcall";

/** Collapse whitespace and truncate long values for one-line display. */
export function compact(value: unknown, max = 100): string {
  // Replacing every whitespace run prevents multi-line call rows.
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The one-line description of a call: `read` + `src/a.ts:1-50`, `bash` +
 * `go test ./...`, or for a rendererless tool, `toolcall` + its name.
 */
export function describeTool(name: string, args: any, expanded = false): { label: string; details: string } {
  if (!isBuiltIn(name)) return { label: FALLBACK_LABEL, details: name };
  return { label: name, details: toolDetails(name, args ?? {}, expanded) };
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
