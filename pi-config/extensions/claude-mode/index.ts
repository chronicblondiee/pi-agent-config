/**
 * claude-mode: Claude-Code-style ergonomics for pi.dev.
 *
 * Adds a confirmation gate before bash/write/edit, plus slash commands:
 *   /plan                - read-only mode (read, grep, find, ls only)
 *   /yolo                - disable the gate for this session
 *   /ask                 - re-enable the gate (default at startup)
 *   /trust               - show current mode and remembered allow-list
 *   /trust-tool <name>   - pre-allow a gated tool (bash|edit|write)
 *   /untrust-tool <name> - revoke a pre-allowed tool
 *
 * State is per-session and resets on restart.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Built-ins plus custom tools shipped in this repo. Keep aligned with any new
// tools added under pi-config/extensions/ — claude-mode replaces the active
// list wholesale on /plan|/ask|/yolo, so any tool name missing here vanishes
// after the first mode toggle.
const ASK_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "fetch", "question", "ast-grep", "test", "remember", "forget"];
const PLAN_TOOLS = ["read", "grep", "find", "ls", "question", "ast-grep", "remember", "forget"];
const GATED = new Set(["bash", "write", "edit"]);

type Mode = "ask" | "plan" | "yolo";

export default function claudeModeExtension(pi: ExtensionAPI): void {
	let mode: Mode = "ask";
	const allowedCommands = new Set<string>();
	const allowedTools = new Set<string>();

	pi.on("tool_call", async (event, ctx) => {
		if (mode === "yolo") return;
		if (!GATED.has(event.toolName)) return;

		if (mode === "plan") {
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

	function setStatus(ctx: ExtensionContext): void {
		const label =
			mode === "plan"
				? ctx.ui.theme.fg("warning", "[plan]")
				: mode === "yolo"
					? ctx.ui.theme.fg("error", "[yolo]")
					: ctx.ui.theme.fg("muted", "[ask]");
		ctx.ui.setStatus("claude-mode", label);
	}

	function setMode(next: Mode, ctx: ExtensionContext): void {
		mode = next;
		pi.setActiveTools(next === "plan" ? PLAN_TOOLS : ASK_TOOLS);
		setStatus(ctx);
		ctx.ui.notify(`claude-mode: ${next}`, next === "yolo" ? "warning" : "info");
	}

	pi.registerCommand("plan", {
		description: "Read-only mode: no bash/write/edit",
		handler: async (_args, ctx) => setMode("plan", ctx),
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
			setMode("yolo", ctx);
		},
	});

	pi.registerCommand("ask", {
		description: "Re-enable confirmation gate (default)",
		handler: async (_args, ctx) => {
			allowedCommands.clear();
			allowedTools.clear();
			setMode("ask", ctx);
		},
	});

	pi.registerCommand("trust", {
		description: "Show current mode and remembered allow-list",
		handler: async (_args, ctx) => {
			const cmds = [...allowedCommands];
			const tools = [...allowedTools];
			const lines = [
				`mode: ${mode}`,
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

	pi.on("session_start", async (_event, ctx) => setStatus(ctx));
}
