import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
	let maxContextTokens: number | null = null;
	let footerSet = false;
	let compactionInFlight = false;

	// ── Parse token values like "256k", "128000", "1m" ──
	function parseTokenValue(input: string): number | undefined {
		const trimmed = input.trim().toLowerCase();

		const kMatch = trimmed.match(/^(\d+(?:\.\d+)?)k$/);
		if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);

		const mMatch = trimmed.match(/^(\d+(?:\.\d+)?)m$/);
		if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1_000_000);

		const num = parseInt(trimmed, 10);
		if (!isNaN(num) && num > 0) return num;
		return undefined;
	}

	function fmt(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
		return String(n);
	}

	function isDisableValue(input: string): boolean {
		const trimmed = input.trim().toLowerCase();
		return trimmed === "off" || trimmed === "none" || trimmed === "0";
	}

	async function maybeCompact(
		ctx: Parameters<Parameters<typeof pi.on>[1]>[1],
		reason: string,
	): Promise<void> {
		if (maxContextTokens === null || compactionInFlight) return;

		const usage = ctx.getContextUsage();
		if (!usage || typeof usage.tokens !== "number") return;

		const buffer = Math.max(8192, Math.min(16384, Math.floor(maxContextTokens * 0.1)));
		const threshold = maxContextTokens - buffer;
		if (usage.tokens <= threshold) return;

		compactionInFlight = true;
		try {
			ctx.ui.notify(`Context at ${fmt(usage.tokens)} / ${fmt(maxContextTokens)} — ${reason}`, "info");
			await ctx.compact({
				customInstructions: `Compact the conversation to keep total context under ${maxContextTokens} tokens. Preserve all important decisions, code changes, and next steps.`,
			});
		} finally {
			compactionInFlight = false;
		}
	}

	// ── Install custom footer ──
	function installFooter(ctx: Parameters<Parameters<typeof pi.on>[1]>[1]) {
		if (footerSet) return;
		footerSet = true;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsubBranch,
				invalidate() {},
				render(width: number): string[] {
					// ── Token / cache / cost stats ──
					let input = 0,
						output = 0,
						cacheRead = 0,
						cacheWrite = 0,
						cost = 0;
					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							input += m.usage.input;
							output += m.usage.output;
							cacheRead += m.usage.cacheRead ?? 0;
							cacheWrite += m.usage.cacheWrite ?? 0;
							cost += m.usage.cost.total;
						}
					}

					const cacheReadShare =
						cacheRead + cacheWrite > 0
							? ((cacheRead / (cacheRead + cacheWrite)) * 100).toFixed(1)
							: "0.0";

					const stats = [
						theme.fg("dim", `↑${fmt(input)}`),
						theme.fg("dim", `↓${fmt(output)}`),
						theme.fg("dim", `R${fmt(cacheRead)}`),
						theme.fg("dim", `W${fmt(cacheWrite)}`),
						theme.fg("dim", `CR${cacheReadShare}%`),
						theme.fg("dim", `$${cost.toFixed(3)}`),
					];

					// ── Context usage ──
					const usage = ctx.getContextUsage();
					const currentTokens = usage?.tokens ?? 0;
					const modelWindow = ctx.model?.contextWindow ?? 0;

					let contextDisplay: string;
					if (maxContextTokens !== null && maxContextTokens > 0) {
						const pct = ((currentTokens / maxContextTokens) * 100).toFixed(1);
						contextDisplay = `${pct}%/${fmt(maxContextTokens)}(${fmt(modelWindow)})`;
					} else {
						const pct = modelWindow > 0 ? ((currentTokens / modelWindow) * 100).toFixed(1) : "0.0";
						contextDisplay = `${pct}%/${fmt(modelWindow)}`;
					}
					stats.push(theme.fg("dim", contextDisplay));

					// ── Auto-compaction indicator ──
					if (maxContextTokens !== null) {
						stats.push(theme.fg("dim", "(auto)"));
					}

					// ── Extension statuses (inline) ──
					for (const [, text] of footerData.getExtensionStatuses()) {
						if (text) stats.push(text);
					}

					// ── Model info ──
					const modelId = ctx.model?.id ?? "no-model";
					const provider = ctx.model?.provider;
					const thinking = (ctx as { thinkingLevel?: string }).thinkingLevel;
					const modelParts: string[] = [];
					if (provider) modelParts.push(theme.fg("dim", `(${provider})`));
					modelParts.push(theme.fg("dim", modelId));
					if (thinking && thinking !== "off") modelParts.push(theme.fg("dim", `• ${thinking}`));

					// ── Assemble line ──
					const left = stats.join(" ");
					const right = modelParts.join(" ");
					const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
					return [truncateToWidth(left + pad + right, width)];
				},
			};
		});
	}

	// ── /max-context command ──
	pi.registerCommand("max-context", {
		description:
			"Set a hard cap on context usage. Auto-compacts before exceeding the limit. Usage: /max-context 256k, /max-context 128000, /max-context off",
		handler: async (args, ctx) => {
			installFooter(ctx);

			if (!args || args.trim() === "") {
				if (maxContextTokens !== null) {
					ctx.ui.notify(
						`Max context: ${fmt(maxContextTokens)} (${maxContextTokens.toLocaleString()} tokens). Use /max-context off to clear.`,
						"info",
					);
				} else {
					ctx.ui.notify("No max context set. Usage: /max-context 256k", "info");
				}
				return;
			}

			if (isDisableValue(args)) {
				maxContextTokens = null;
				ctx.ui.notify("Max context auto-compaction disabled.", "info");
				return;
			}

			const parsed = parseTokenValue(args);
			if (parsed === undefined) {
				ctx.ui.notify(
					"Invalid format. Use e.g. /max-context 256k, /max-context 128000, or /max-context off",
					"error",
				);
				return;
			}

			maxContextTokens = parsed;
			ctx.ui.notify(
				`Max context set to ${fmt(parsed)} (${parsed.toLocaleString()} tokens). Will auto-compact before exceeding this limit.`,
				"info",
			);
		},
	});

	// ── Check context usage before each LLM call ──
	pi.on("turn_start", async (_event, ctx) => {
		await maybeCompact(ctx, "compacting before next turn...");
	});

	// ── Install footer on session start ──
	pi.on("session_start", async (_event, ctx) => {
		installFooter(ctx);
	});
}
