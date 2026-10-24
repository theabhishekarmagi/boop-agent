import { test } from "node:test";
import assert from "node:assert/strict";
import { GOOGLE_WORKSPACE_SCOPES, gmailToolForToolkit, isWorkspaceCustomAuth } from "../server/google-workspace.js";
import { createGmailPriorityTools } from "../server/gmail-priority.js";

test("Workspace priority overview uses native Google Super tools and preserves budgets", async () => {
  const calls: Array<{account: string; slug: string; args: Record<string, unknown>}> = [];
  const priority = createGmailPriorityTools([{ id:"workspace-account", label:"Google Workspace" }],
    async (account, tool, args) => {
      const slug = gmailToolForToolkit("googlesuper", tool);
      calls.push({account,slug,args});
      const message = {messageId:"mail-1",subject:"Reply today",sender:"sender@example.com"};
      return {data:slug === "GOOGLESUPER_FETCH_EMAILS" ? {messages:[message]} : message};
    });
  await priority.list({});
  await priority.list({window_days:30});
  assert.equal(calls.length,1);
  assert.equal(calls[0].account,"workspace-account");
  assert.equal(calls[0].slug,"GOOGLESUPER_FETCH_EMAILS");
  assert.equal(calls[0].args.max_results,20);
  assert.equal(calls[0].args.include_payload,false);
  await assert.rejects(priority.details(["another-user-message"]));
  await priority.details(["mail-1"]);
  assert.equal(calls[1].slug,"GOOGLESUPER_FETCH_MESSAGE_BY_MESSAGE_ID");
  assert.equal(calls[1].account,"workspace-account");
  assert.equal(gmailToolForToolkit("gmail","GMAIL_FETCH_EMAILS"),"GMAIL_FETCH_EMAILS");
  assert.throws(()=>gmailToolForToolkit("googlesuper","GMAIL_SEND_EMAIL"));
});

test("Workspace consent covers the requested apps without unrelated Super defaults", () => {
  for(const api of ["gmail.modify","calendar","tasks","drive","documents","spreadsheets","presentations"]) {
    assert(GOOGLE_WORKSPACE_SCOPES.includes(`https://www.googleapis.com/auth/${api}`));
  }
  assert(!GOOGLE_WORKSPACE_SCOPES.some(scope=>/adwords|analytics|photos|contacts/.test(scope)));
});

test("Workspace requires the enabled custom OAuth config, rejecting blocked managed auth and wrong toolkits", () => {
  const config = {toolkit:{slug:"googlesuper"},authScheme:"OAUTH2",isComposioManaged:false,status:"ENABLED"};
  assert.equal(isWorkspaceCustomAuth(config),true);
  assert.equal(isWorkspaceCustomAuth({...config,isComposioManaged:true}),false);
  assert.equal(isWorkspaceCustomAuth({...config,toolkit:{slug:"gmail"}}),false);
  assert.equal(isWorkspaceCustomAuth({...config,authScheme:"API_KEY"}),false);
  assert.equal(isWorkspaceCustomAuth({...config,status:"DISABLED"}),false);
});
