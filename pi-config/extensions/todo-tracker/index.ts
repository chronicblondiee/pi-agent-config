/**
 * Todo Tracker Extension
 *
 * Registers a `todo` tool the LLM can use to manage a task list.
 * Shows a persistent status widget with completed/total count.
 * State is reconstructed from session history on reload so /fork works correctly.
 *
 * Commands:
 *   /todos   — open interactive todo viewer
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

interface TodoDetails {
  action: "list" | "add" | "toggle" | "clear";
  todos: Todo[];
  nextId: number;
}

const TodoParams = Type.Object({
  action: StringEnum(["list", "add", "toggle", "clear"] as const),
  text: Type.Optional(
    Type.String({ description: "Todo text (required for add)" }),
  ),
  id: Type.Optional(
    Type.Number({ description: "Todo ID (required for toggle)" }),
  ),
});

class TodoViewer {
  private todos: Todo[];
  private theme: Theme;
  private onClose: () => void;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(todos: Todo[], theme: Theme, onClose: () => void) {
    this.todos = todos;
    this.theme = theme;
    this.onClose = onClose;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onClose();
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const th = this.theme;

    lines.push("");
    const title = th.fg("accent", " Todos ");
    const header =
      th.fg("borderMuted", "─".repeat(3)) +
      title +
      th.fg("borderMuted", "─".repeat(Math.max(0, width - 10)));
    lines.push(truncateToWidth(header, width));
    lines.push("");

    if (this.todos.length === 0) {
      lines.push(
        truncateToWidth(
          `  ${th.fg("dim", "No todos yet. Ask the agent to add some!")}`,
          width,
        ),
      );
    } else {
      const done = this.todos.filter((t) => t.done).length;
      lines.push(
        truncateToWidth(
          `  ${th.fg("muted", `${done}/${this.todos.length} completed`)}`,
          width,
        ),
      );
      lines.push("");

      for (const todo of this.todos) {
        const check = todo.done ? th.fg("success", "✓") : th.fg("dim", "○");
        const id = th.fg("accent", `#${todo.id}`);
        const text = todo.done
          ? th.fg("dim", todo.text)
          : th.fg("text", todo.text);
        lines.push(truncateToWidth(`  ${check} ${id} ${text}`, width));
      }
    }

    lines.push("");
    lines.push(
      truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width),
    );
    lines.push("");

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

export default function (pi: ExtensionAPI): void {
  let todos: Todo[] = [];
  let nextId = 1;

  function reconstructState(ctx: ExtensionContext): void {
    todos = [];
    nextId = 1;

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;

      const details = msg.details as TodoDetails | undefined;
      if (details) {
        todos = details.todos;
        nextId = details.nextId;
      }
    }
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    const done = todos.filter((t) => t.done).length;
    const label = todos.length === 0
      ? ""
      : `${done}/${todos.length} todos`;
    if (label) {
      ctx.ui.setStatus("todo-tracker", label);
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    reconstructState(ctx);
    updateStatus(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    reconstructState(ctx);
    updateStatus(ctx);
  });

  pi.registerTool({
    name: "todo",
    label: "Todo",
    description: "Manage a todo list for multi-step tasks. Actions: list, add (text), toggle (id), clear",
    promptSnippet: "Track progress on multi-step tasks",
    promptGuidelines: [
      "Use todo to track progress on tasks with more than 3 steps. Add items at the start, toggle as you complete them.",
    ],
    parameters: TodoParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      switch (params.action) {
        case "list":
          return {
            content: [
              {
                type: "text",
                text: todos.length
                  ? todos
                      .map((t) => `[${t.done ? "x" : " "}] #${t.id}: ${t.text}`)
                      .join("\n")
                  : "No todos",
              },
            ],
            details: { action: "list", todos: [...todos], nextId },
          };

        case "add": {
          if (!params.text) {
            return {
              content: [{ type: "text", text: "Error: text required for add" }],
              details: { action: "add", todos: [...todos], nextId },
            };
          }
          const newTodo: Todo = {
            id: nextId++,
            text: params.text,
            done: false,
          };
          todos.push(newTodo);
          updateStatus(ctx);
          return {
            content: [
              {
                type: "text",
                text: `Added todo #${newTodo.id}: ${newTodo.text}`,
              },
            ],
            details: { action: "add", todos: [...todos], nextId },
          };
        }

        case "toggle": {
          if (params.id === undefined) {
            return {
              content: [
                { type: "text", text: "Error: id required for toggle" },
              ],
              details: { action: "toggle", todos: [...todos], nextId },
            };
          }
          const todo = todos.find((t) => t.id === params.id);
          if (!todo) {
            return {
              content: [
                { type: "text", text: `Todo #${params.id} not found` },
              ],
              details: { action: "toggle", todos: [...todos], nextId },
            };
          }
          todo.done = !todo.done;
          updateStatus(ctx);
          return {
            content: [
              {
                type: "text",
                text: `Todo #${todo.id} ${todo.done ? "completed" : "uncompleted"}`,
              },
            ],
            details: { action: "toggle", todos: [...todos], nextId },
          };
        }

        case "clear": {
          const count = todos.length;
          todos = [];
          nextId = 1;
          updateStatus(ctx);
          return {
            content: [{ type: "text", text: `Cleared ${count} todos` }],
            details: { action: "clear", todos: [], nextId: 1 },
          };
        }

        default:
          return {
            content: [
              { type: "text", text: `Unknown action: ${params.action}` },
            ],
            details: { action: "list", todos: [...todos], nextId },
          };
      }
    },

    renderCall(args, theme, _context) {
      let text =
        theme.fg("toolTitle", theme.bold("todo ")) +
        theme.fg("muted", args.action);
      if (args.text)
        text += ` ${theme.fg("dim", `"${args.text}"`)}`;
      if (args.id !== undefined)
        text += ` ${theme.fg("accent", `#${args.id}`)}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      const details = result.details as TodoDetails | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(
          text?.type === "text" ? text.text : "",
          0,
          0,
        );
      }

      const todoList = details.todos;

      switch (details.action) {
        case "list": {
          if (todoList.length === 0) {
            return new Text(theme.fg("dim", "No todos"), 0, 0);
          }
          let listText = theme.fg("muted", `${todoList.length} todo(s):`);
          const display = expanded
            ? todoList
            : todoList.slice(0, 5);
          for (const t of display) {
            const check = t.done
              ? theme.fg("success", "✓")
              : theme.fg("dim", "○");
            const itemText = t.done
              ? theme.fg("dim", t.text)
              : theme.fg("muted", t.text);
            listText += `\n${check} ${theme.fg(
              "accent",
              `#${t.id}`,
            )} ${itemText}`;
          }
          if (!expanded && todoList.length > 5) {
            listText += `\n${theme.fg(
              "dim",
              `... ${todoList.length - 5} more`,
            )}`;
          }
          return new Text(listText, 0, 0);
        }

        case "add": {
          const added = todoList[todoList.length - 1];
          return new Text(
            theme.fg("success", "✓ Added ") +
              theme.fg("accent", `#${added.id}`) +
              " " +
              theme.fg("muted", added.text),
            0,
            0,
          );
        }

        case "toggle": {
          const text = result.content[0];
          const msg = text?.type === "text" ? text.text : "";
          return new Text(
            theme.fg("success", "✓ ") + theme.fg("muted", msg),
            0,
            0,
          );
        }

        case "clear":
          return new Text(
            theme.fg("success", "✓ ") +
              theme.fg("muted", "Cleared all todos"),
            0,
            0,
          );
      }
    },
  });

  pi.registerCommand("todos", {
    description: "Show all todos on the current branch",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/todos requires interactive mode", "error");
        return;
      }

      await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
        return new TodoViewer(todos, theme, () => done());
      });
    },
  });
}
