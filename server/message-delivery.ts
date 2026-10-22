import { isOperator } from "./workspace-context.js";
// Shared delivery for channel acknowledgments and scheduled notifications.
export async function deliverToConversation(conversationId: string, text: string): Promise<void> {
  if (!isOperator() && !conversationId.startsWith("web:") && !conversationId.startsWith("telegram:")) {
    throw new Error("This workspace has no verified messaging channel yet.");
  }
  if (conversationId.startsWith("sms:")) {
    const { sendImessage } = await import("./sendblue.js");
    await sendImessage(conversationId.slice(4), text);
  } else if (conversationId.startsWith("telegram:")) {
    const { sendTelegramReply } = await import("./telegram.js");
    await sendTelegramReply(conversationId, text);
  } else if (conversationId.startsWith("whatsapp:twilio:")) {
    const { sendTwilioWhatsAppReply } = await import("./twilio-whatsapp.js");
    await sendTwilioWhatsAppReply(conversationId, text);
  }
}
