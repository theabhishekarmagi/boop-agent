// Shared delivery for channel acknowledgments and scheduled notifications.
export async function deliverToConversation(conversationId: string, text: string): Promise<void> {
  if (conversationId.startsWith("sms:")) {
    const { sendImessage } = await import("./sendblue.js");
    await sendImessage(conversationId.slice(4), text);
  } else if (conversationId.startsWith("telegram:")) {
    const { sendTelegramReply } = await import("./telegram.js");
    await sendTelegramReply(conversationId, text);
  } else if (conversationId.startsWith("whatsapp:")) {
    const { sendWhatsAppReply } = await import("./whatsapp.js");
    await sendWhatsAppReply(conversationId, text);
  }
}
