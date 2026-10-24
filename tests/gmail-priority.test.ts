import { test } from "node:test";
import assert from "node:assert/strict";
import { createGmailPriorityTools, priorityOnlyGroup, GMAIL_PRIORITY_INSTRUCTIONS } from "../server/gmail-priority.js";
import { runAgentQuery } from "../server/openai-runtime.js";
import { ScriptedModel, functionCall, assistantMessage } from "@openai/agents-core/testing";
const account = { id: "own-account", label: "test@example.com" };
const message = (id: string) => ({ messageId: id, sender: "sender@example.com", preview: { subject: "Deadline today", body: "Please reply today." }, messageTimestamp: "2026-10-24T10:00:00Z", labelIds: ["UNREAD"] });

test("one small metadata batch is cached; coverage and pagination are honest", async () => {
  const calls: Array<{ slug: string; args: Record<string, unknown> }> = [];
  const priority = createGmailPriorityTools([account], async (id, slug, args) => {
    assert.equal(id, account.id); calls.push({ slug, args });
    return { data: { messages: Array.from({length:30}, (_, i) => message(String(i))), nextPageToken: "more" } };
  });
  const result = await priority.list({});
  assert.equal(await priority.list({ window_days: 14 }), result);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].slug, "GMAIL_FETCH_EMAILS");
  assert.equal(calls[0].args.max_results, 20);
  assert.equal(calls[0].args.verbose, false); assert.equal(calls[0].args.include_payload, false);
  const output = JSON.parse(JSON.stringify(result));
  assert.equal(output.messages.length, 20); assert.equal(output.coverage.hasMore, true);
  assert.equal(output.coverage.exhaustive, false); assert.equal(output.coverage.windowDays, 7);
  assert.equal(output.messages[0].body, undefined);
});

test("empty inbox returns explicit zero coverage without broadening the search", async () => {
  let calls = 0;
  const priority = createGmailPriorityTools([account], async () => { calls++; return {data:{messages:[],nextPageToken:""}}; });
  const result = JSON.parse(JSON.stringify(await priority.list({})));
  assert.equal(result.coverage.reviewed, 0); assert.equal(result.coverage.exhaustive, false);
  assert.deepEqual(result.messages, []); assert.equal(calls, 1);
});

test("detail reads are concurrent, limited to three listed IDs, cached and never full-thread reads", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const read: string[] = [];
  const priority = createGmailPriorityTools([account], async (_account, slug, args) => {
    if (slug === "GMAIL_FETCH_EMAILS") return {data:{messages:[message("a"),message("b"),message("c"),message("d")]}};
    assert.equal(slug, "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID");
    assert.equal(args.format, "full"); read.push(String(args.message_id)); await gate;
    return {data:{...message(String(args.message_id)),messageText:"x".repeat(6000)}};
  });
  await priority.list({});
  await assert.rejects(priority.details(["unknown"]), /returned by this overview/);
  await assert.rejects(priority.details(["a","b","c","d"]), /at most three/);
  const details = priority.details(["a","b","c"]);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(read.length, 3);
  release();
  const result = await details;
  assert.deepEqual(await priority.details(["c","b","a"]), result);
  assert.equal(read.length, 3);
  assert.equal(JSON.parse(JSON.stringify(result))[0].bodyTruncated, true);
  await assert.rejects(priority.details(["d"]), /budget is used/);
});

test("account selection is explicit and unknown/cross-account message IDs are refused", async () => {
  let calls = 0;
  const priority = createGmailPriorityTools([account,{id:"second",label:"second@example.com"}], async (id) => {
    assert.equal(id, account.id); calls++; return {data:{messages:[message("a")]}};
  });
  await assert.rejects(priority.list({}), /Choose one/);
  await assert.rejects(priority.list({connection_id:"another-owner-account"}), /Choose one/);
  assert.equal(calls, 0);
  await priority.list({connection_id:account.id});
  await assert.rejects(priority.list({connection_id:"second"}), /scoped to another account/);
  await assert.rejects(priority.details(["other-account-message"]));
  assert.equal(calls, 1);
});

test("provider failures and malformed responses are not misreported as an empty inbox", async () => {
  for (const result of [{data:{successful:false,error:"401"}}, {data:{messages:"bad"}}, {data:{messages:[{}]}}]) {
    const priority = createGmailPriorityTools([account], async () => result);
    await assert.rejects(priority.list({}));
  }
});

test("priority tool surface excludes workbench/discovery and the real SDK completes in two model turns", async () => {
  let reads = 0;
  const priority = createGmailPriorityTools([account], async () => { reads++; return {data:{messages:[message("a")]}}; });
  const group = priorityOnlyGroup({ name:"gmail",tools:[...priority.tools, {type:"hosted_tool",name:"not-allowed"} as never] });
  assert.equal(group.tools.length, 2);
  assert.throws(() => priorityOnlyGroup({name:"gmail",tools:[]}), /unavailable/);
  const model = new ScriptedModel([
    [functionCall("mcp__gmail__priority_inbox", {}, {callId:"inbox",namespace:"gmail"})],
    [assistantMessage("Deadline today — please reply. Reviewed 1 recent matching email; this is a sample.")],
  ]);
  const events = [];
  for await (const event of runAgentQuery({prompt:"Show priority emails", options:{systemPrompt:GMAIL_PRIORITY_INSTRUCTIONS,toolGroups:{gmail:group}}}, model)) events.push(event);
  assert.equal(reads, 1); assert.equal(model.calls.length, 2); model.assertComplete();
  assert.match(JSON.stringify(events), /Deadline today/);
});

test("only the bounded priority workflow uses the configured fast model", async () => {
  const {modelForExecution}=await import("../server/model-config.js");
  const old=process.env.BOOP_SMALL_MODEL; process.env.BOOP_SMALL_MODEL="gpt-5.6-luna";
  let normalCalls=0; const normal=async()=>{normalCalls++;return "gpt-5.6-sol";};
  try {
    assert.equal(await modelForExecution("gmail_priority",normal),"gpt-5.6-luna");
    assert.equal(normalCalls,0);
    assert.equal(await modelForExecution("general",normal),"gpt-5.6-sol");
    assert.equal(await modelForExecution(undefined,normal),"gpt-5.6-sol");
    assert.equal(normalCalls,2);
  } finally {if(old===undefined)delete process.env.BOOP_SMALL_MODEL;else process.env.BOOP_SMALL_MODEL=old;}
});
