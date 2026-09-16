import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = stripTypeScriptTypes(readFileSync(new URL("../extensions/index.ts", import.meta.url), "utf8"));
const { default: extension } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

function harness() {
	const handlers = new Map();
	const commands = new Map();
	const compactions = [];
	const delivered = [];
	const state = { tokens: 100_000, idle: true };
	const ctx = {
		hasUI: false,
		getContextUsage: () => ({ tokens: state.tokens, contextWindow: 200_000 }),
		isIdle: () => state.idle,
		compact: (options) => compactions.push(options),
	};
	extension({
		on: (event, handler) => handlers.set(event, handler),
		registerCommand: (name, command) => commands.set(name, command),
		sendUserMessage: (content) => delivered.push(content),
	});
	return {
		state, compactions, delivered,
		command: (args) => commands.get("max-context").handler(args, ctx),
		emit: (event, data = {}) => handlers.get(event)(data, ctx),
		input: (text, images) => handlers.get("input")({ text, images, source: "interactive" }, ctx),
	};
}

test("rearms after successful compaction even when current usage is unknown", async () => {
	const h = harness();
	await h.command("100k");
	h.state.tokens = null;
	h.compactions[0].onComplete({ estimatedTokensAfter: 20_000 });
	h.state.tokens = 95_000;
	await h.emit("agent_end");
	assert.equal(h.compactions.length, 2);
});

test("ineffective compaction waits for growth before retrying", async () => {
	const h = harness();
	await h.command("100k");
	h.compactions[0].onComplete({ estimatedTokensAfter: 95_000 });
	h.state.tokens = 95_000;
	await h.emit("agent_end");
	assert.equal(h.compactions.length, 1);
	h.state.tokens = 106_000;
	await h.emit("agent_end");
	assert.equal(h.compactions.length, 2);
});

test("failed compaction releases the triggering prompt without a retry loop", async () => {
	const h = harness();
	h.state.tokens = 1000;
	await h.command("100k");
	h.state.tokens = 95_000;
	assert.deepEqual(h.input("continue working"), { action: "handled" });
	h.compactions[0].onError(new Error("network failure"));
	assert.deepEqual(h.delivered, ["continue working"]);
	await h.emit("agent_end");
	assert.equal(h.compactions.length, 1);
});

test("queues busy compaction input and preserves images, including after disabling", async () => {
	const h = harness();
	await h.command("100k");
	h.state.idle = false;
	const image = { type: "image", data: "AA==", mimeType: "image/png" };
	assert.deepEqual(h.input("inspect this", [image]), { action: "handled" });
	await h.command("off");
	assert.deepEqual(h.input("then explain"), { action: "handled" });
	assert.deepEqual(h.delivered, []);
	h.compactions[0].onComplete({ estimatedTokensAfter: 20_000 });
	assert.deepEqual(h.delivered, [[{ type: "text", text: "inspect this" }, image], "then explain"]);
});

test("session switches reset retry state and ignore stale compaction callbacks", async () => {
	const h = harness();
	await h.command("100k");
	h.input("old session message");
	await h.emit("session_start", { reason: "resume" });
	h.state.tokens = 95_000;
	assert.deepEqual(h.input("new session message"), { action: "handled" });
	assert.equal(h.compactions.length, 2);
	h.compactions[0].onComplete({ estimatedTokensAfter: 20_000 });
	h.compactions[0].onError(new Error("late error"));
	assert.deepEqual(h.delivered, []);
	h.compactions[1].onComplete({ estimatedTokensAfter: 20_000 });
	assert.deepEqual(h.delivered, ["new session message"]);
});
