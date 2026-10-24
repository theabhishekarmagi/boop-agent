import { test } from "node:test";
import assert from "node:assert/strict";
import { searchToolkitCatalog } from "../server/composio.js";

test("catalog search forwards search and pagination and maps non-curated apps", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/api/v3.1/toolkits");
    assert.equal(url.searchParams.get("search"), "Telegram & chat");
    assert.equal(url.searchParams.get("cursor"), "next-page");
    assert.equal(url.searchParams.get("limit"), "20");
    assert.equal(url.searchParams.has("x-api-key"), false);
    assert(options?.signal);
    return Response.json({
      items: [
        { slug: "other", name: "Other", composio_managed_auth_schemes: ["OAUTH2"] },
        { slug: "telegram", name: "Telegram & chat", composio_managed_auth_schemes: [],
          meta: { tools_count: 18, logo: "https://example.com/logo.png" } },
      ],
      next_cursor: "last-page", total_items: 35,
    });
  };
  try {
    const result = await searchToolkitCatalog("Telegram & chat", "next-page");
    assert.equal(result.totalItems, 35);
    assert.equal(result.nextCursor, "last-page");
    assert.equal(result.items[0].slug, "telegram");
    assert.equal(result.items[0].authMode, "byo");
    assert.equal(result.items[0].toolCount, 18);
    assert.equal(result.items[1].authMode, "managed");
  } finally {
    globalThis.fetch = original;
  }
});

test("catalog failure is not returned as an empty successful search", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("private upstream details", { status: 429 });
  try {
    await assert.rejects(searchToolkitCatalog("telegram"), /^Error: Composio catalog search failed \(HTTP 429\)\.$/);
  } finally {
    globalThis.fetch = original;
  }
});

test("Google Workspace search resolves the native unified toolkit instead of hiding it", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    assert.equal(new URL(String(input)).searchParams.get("search"),"googlesuper");
    return Response.json({items:[{slug:"googlesuper",name:"Google Super",
      composio_managed_auth_schemes:["OAUTH2"]}]});
  };
  try {
    const result = await searchToolkitCatalog("Google Workspace");
    assert.equal(result.items[0].displayName,"Google Workspace");
    assert.equal(result.items[0].authMode,"byo");
    assert.match(result.items[0].description!,/Gmail, Calendar, Tasks/);
  } finally { globalThis.fetch = original; }
});
