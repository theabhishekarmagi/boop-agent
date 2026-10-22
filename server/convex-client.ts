import { ConvexHttpClient } from "convex/browser";
import { currentOwner } from "./workspace-context.js";
import { runtimeToken } from "./runtime-identity.js";

const url = process.env.CONVEX_URL;
if (!url) {
  throw new Error(
    "CONVEX_URL is not set. Run `npm run setup` or `npx convex dev` to configure Convex.",
  );
}

// A different authenticated client per operation: never mutate the auth on a
// shared HTTP client while requests from two workspaces are running in parallel.
export const convex = new Proxy({} as ConvexHttpClient, {
  get(_target, property) {
    if (!["query", "mutation", "action"].includes(String(property))) {
      throw new Error(`Unsupported workspace client operation: ${String(property)}`);
    }
    return async (...args: unknown[]) => {
      const owner = currentOwner();
      const client = new ConvexHttpClient(url);
      client.setAuth(await runtimeToken(owner));
      return Reflect.apply(Reflect.get(client, property), client, args);
    };
  },
});
