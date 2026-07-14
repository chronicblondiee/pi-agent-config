/**
 * claude-mode: Claude-Code-style ergonomics for pi.dev.
 *
 * Adds a confirmation gate before bash/write/edit, plus slash commands:
 *   /plan                - planning mode (bash allowed, write/edit blocked)
 *   /yolo                - disable the gate for this session
 *   /ask                 - re-enable the gate (default at startup)
 *   /online              - enable web_search and read-only fetch
 *   /offline             - disable web tools (default at startup)
 *   /trust-status        - show current mode and remembered allow-list
 *   /trust-tool <name>   - pre-allow a gated tool (bash|edit|write)
 *   /untrust-tool <name> - revoke a pre-allowed tool
 *
 * State is per-session and resets on restart.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Built-ins plus custom tools shipped in this repo. Keep aligned with any new
// tools added under pi-config/extensions/ — claude-mode replaces the active
// list wholesale on mode changes, so any tool name missing here vanishes after
// the first toggle.
const ASK_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "question", "todo"];
// Plan mode keeps bash available for inspection commands such as `git status`,
// but write/edit stay unavailable and are also blocked defensively below.
const PLAN_TOOLS = ["read", "bash", "grep", "find", "ls", "question"];
const ONLINE_TOOLS = ["web_search", "fetch"];
const GATED = new Set(["bash", "write", "edit"]);
const NETWORK_TOOLS = new Set(ONLINE_TOOLS);

type SafetyMode = "ask" | "plan" | "yolo";
type NetworkMode = "offline" | "online";

export default function claudeModeExtension(pi: ExtensionAPI): void {
	let safetyMode: SafetyMode = "ask";
	let networkMode: NetworkMode = "offline";
	const allowedCommands = new Set<string>();
	const allowedTools = new Set<string>();

	pi.on("tool_call", async (event, ctx) => {
		if (NETWORK_TOOLS.has(event.toolName) && networkMode === "offline") {
			return {
				block: true,
				reason: `${event.toolName} is disabled while offline. Use /online to enable web tools.`,
			};
		}

		if (event.toolName === "fetch") {
			const method = String(event.input?.method ?? "GET").toUpperCase();
			if (method !== "GET" && method !== "HEAD") {
				return {
					block: true,
					reason: `Online mode allows fetch only for GET/HEAD. Use confirmed bash for intentional network mutation (${method}).`,
				};
			}
		}

		if (safetyMode === "yolo") return;
		if (!GATED.has(event.toolName)) return;

		if (safetyMode === "plan" && event.toolName !== "bash") {
			return {
				block: true,
				reason: `Plan mode: ${event.toolName} is disabled. Use /ask to restore full tools.`,
			};
		}

		if (event.toolName === "bash") {
			const command = String(event.input.command ?? "");
			if (allowedTools.has("bash") || allowedCommands.has(command)) return;
			if (!ctx.hasUI) {
				return { block: true, reason: "No UI to confirm bash; blocked." };
			}
			const choice = await ctx.ui.select(
				`Run bash command?\n\n  ${command}`,
				["Yes", "No", "Always for this exact command"],
			);
			if (!choice || choice === "No") return { block: true, reason: "Denied by user." };
			if (choice.startsWith("Always")) allowedCommands.add(command);
			return;
		}

		if (allowedTools.has(event.toolName)) return;
		if (!ctx.hasUI) {
			return { block: true, reason: `No UI to confirm ${event.toolName}; blocked.` };
		}
		const path = String(event.input.file_path ?? event.input.path ?? "<unknown path>");
		const verb = event.toolName === "write" ? "Write file" : "Edit file";
		const choice = await ctx.ui.select(
			`${verb}: ${path}`,
			["Yes", "No", `Always allow ${event.toolName} this session`],
		);
		if (!choice || choice === "No") return { block: true, reason: "Denied by user." };
		if (choice.startsWith("Always")) allowedTools.add(event.toolName);
	});

	function activeTools(): string[] {
		const base = safetyMode === "plan" ? PLAN_TOOLS : ASK_TOOLS;
		return networkMode === "online" ? [...base, ...ONLINE_TOOLS] : base;
	}

	function refreshActiveTools(ctx: ExtensionContext): void {
		pi.setActiveTools(activeTools());
		setStatus(ctx);
	}

	function setStatus(ctx: ExtensionContext): void {
		const status = `${safetyMode} ${networkMode}`;
		const label =
			safetyMode === "plan"
				? ctx.ui.theme.fg("warning", `[${status}]`)
				: safetyMode === "yolo"
					? ctx.ui.theme.fg("error", `[${status}]`)
					: ctx.ui.theme.fg("muted", `[${status}]`);
		ctx.ui.setStatus("claude-mode", label);
	}

	function setSafetyMode(next: SafetyMode, ctx: ExtensionContext): void {
		safetyMode = next;
		refreshActiveTools(ctx);
		ctx.ui.notify(`claude-mode: ${next}`, next === "yolo" ? "warning" : "info");
	}

	function setNetworkMode(next: NetworkMode, ctx: ExtensionContext): void {
		networkMode = next;
		refreshActiveTools(ctx);
		ctx.ui.notify(
			next === "online"
				? "claude-mode: online (web_search and read-only fetch enabled)"
				: "claude-mode: offline (web tools disabled)",
			"info",
		);
	}

	pi.registerCommand("plan", {
		description: "Planning mode: bash allowed, no write/edit",
		handler: async (_args, ctx) => setSafetyMode("plan", ctx),
	});

	pi.registerCommand("yolo", {
		description: "Disable confirmation gate (this session)",
		handler: async (_args, ctx) => {
			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm(
					"Disable safety gate?",
					"All bash/write/edit calls will run without confirmation for the rest of this session.",
				);
				if (!ok) return;
			}
			setSafetyMode("yolo", ctx);
		},
	});

	pi.registerCommand("ask", {
		description: "Re-enable confirmation gate (default)",
		handler: async (_args, ctx) => {
			allowedCommands.clear();
			allowedTools.clear();
			setSafetyMode("ask", ctx);
		},
	});

	pi.registerCommand("online", {
		description: "Enable web_search and read-only fetch tools",
		handler: async (_args, ctx) => setNetworkMode("online", ctx),
	});

	pi.registerCommand("offline", {
		description: "Disable web tools",
		handler: async (_args, ctx) => setNetworkMode("offline", ctx),
	});

	pi.registerCommand("trust-status", {
		description: "Show current safety/network mode and remembered allow-list",
		handler: async (_args, ctx) => {
			const cmds = [...allowedCommands];
			const tools = [...allowedTools];
			const lines = [
				`safety: ${safetyMode}`,
				`network: ${networkMode}`,
				`active tools: ${activeTools().join(", ")}`,
				`auto-allowed bash commands (${cmds.length}):`,
				...(cmds.length ? cmds.map((c) => `  - ${c}`) : ["  (none)"]),
				`auto-allowed tools: ${tools.length ? tools.join(", ") : "(none)"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("trust-tool", {
		description: "Auto-allow a gated tool for this session (bash|edit|write)",
		handler: async (args, ctx) => {
			const name = args?.trim();
			if (!name) {
				ctx.ui.notify("Usage: /trust-tool <bash|edit|write>", "warning");
				return;
			}
			if (!GATED.has(name)) {
				ctx.ui.notify(
					`${name} is not gated. Gated tools: ${[...GATED].join(", ")}`,
					"warning",
				);
				return;
			}
			allowedTools.add(name);
			ctx.ui.notify(`Trusted ${name} for this session`, "warning");
		},
	});

	pi.registerCommand("untrust-tool", {
		description: "Revoke a session-trusted tool",
		handler: async (args, ctx) => {
			const name = args?.trim();
			if (!name) {
				ctx.ui.notify("Usage: /untrust-tool <name>", "warning");
				return;
			}
			if (allowedTools.delete(name)) {
				ctx.ui.notify(`Revoked trust for ${name}`, "info");
			} else {
				ctx.ui.notify(`${name} was not in the trust list`, "info");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => refreshActiveTools(ctx));
}
