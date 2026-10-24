/** Native Composio unified Google toolkit; no token copying between toolkits. */
export const GOOGLE_WORKSPACE_SLUG = "googlesuper";
export const GOOGLE_WORKSPACE_NAME = "Google Workspace";
export const GOOGLE_WORKSPACE_AUTH_NAME = "Boop Google Workspace";
export const GOOGLE_WORKSPACE_DESCRIPTION = "Gmail, Calendar, Tasks, Drive, Docs, Sheets, and Slides — connect your Google account once. Available actions depend on the permissions you approve.";
// Exclude Google Super's default Ads, Analytics, Contacts and Photos permissions.
export const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
];

export function isWorkspaceCustomAuth(config: {
  toolkit: {slug: string}; authScheme?: string; isComposioManaged?: boolean; status: string;
}): boolean {
  return config.toolkit.slug === GOOGLE_WORKSPACE_SLUG && config.authScheme === "OAUTH2"
    && config.isComposioManaged === false && config.status === "ENABLED";
}

// These exact schemas were checked against the live Google Super catalog.
const PRIORITY_TOOLS: Record<string, string> = {
  GMAIL_FETCH_EMAILS: "GOOGLESUPER_FETCH_EMAILS",
  GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: "GOOGLESUPER_FETCH_MESSAGE_BY_MESSAGE_ID",
};
export function gmailToolForToolkit(toolkit: string, tool: string): string {
  if (toolkit === "gmail") return tool;
  if (toolkit !== GOOGLE_WORKSPACE_SLUG || !PRIORITY_TOOLS[tool]) {
    throw new Error("Unsupported Google Workspace priority tool.");
  }
  return PRIORITY_TOOLS[tool];
}
