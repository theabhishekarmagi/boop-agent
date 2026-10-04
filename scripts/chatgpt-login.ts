import "../server/env-setup.js";
import { loginChatGPT, listOpenAIModels, chatGPTAccounts, selectChatGPTAccount, logoutChatGPT } from "../server/openai-auth.js";

async function main() {
  if (process.argv.includes("--accounts")) { console.log(await chatGPTAccounts()); return; }
  if (process.argv.includes("--logout")) { await logoutChatGPT(); console.log("ChatGPT disconnected."); return; }
  const use = process.argv.find((arg) => arg.startsWith("--use="));
  if (use) { await selectChatGPTAccount(use.slice(6)); console.log("Active ChatGPT account updated."); return; }
  if (process.argv.includes("--models")) {
    for (const model of await listOpenAIModels()) console.log(`${model.id}\t${model.name}`);
    return;
  }
  const clientArg = process.argv.find((arg) => arg.startsWith("--client="));
  await loginChatGPT(process.argv.includes("--add") ? null : clientArg?.slice("--client=".length));
  console.log("\nAvailable models:");
  for (const model of await listOpenAIModels()) console.log(`  ${model.id}`);
}
main().catch((err) => { console.error(err instanceof Error ? err.message : "ChatGPT sign-in failed."); process.exitCode = 1; });
