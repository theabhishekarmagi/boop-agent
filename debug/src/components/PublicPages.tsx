import { useEffect, type ReactNode } from "react";
import "../public.css";

const SUPPORT = "hello.peshi@gmail.com";
const UPDATED = "24 October 2026";

function Footer() {
  return <footer className="public-footer">
    <span>© {new Date().getFullYear()} Boop</span>
    <nav aria-label="Legal"><a href="/privacy">Privacy policy</a><a href="/terms">Terms of service</a></nav>
  </footer>;
}

function Contact() {
  return <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>;
}

function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return <section><h2>{title}</h2>{children}</section>;
}

export function PublicPages({ page }: { page: "home" | "privacy" | "terms" }) {
  useEffect(() => {
    document.title = page === "home" ? "Boop · A little help for your everyday" : `${page === "privacy" ? "Privacy policy" : "Terms of service"} · Boop`;
  }, [page]);

  return <div className={`public-site ${page === "home" ? "public-home" : "public-legal"}`}>
    <a className="public-skip" href="#main">Skip to content</a>
    <header className="public-header">
      <a className="public-brand" href="/" aria-label="Boop home"><img src="/lunagotchi.png" alt="" width="80" height="88" /></a>
      {page !== "home" && <a className="public-back" href="/">← Back to Boop</a>}
    </header>
    {page === "home" ? <main id="main" className="public-intro">
      <h1>Boop is a personal agent that helps you make room for what matters.</h1>
      <p>Start with a message. Boop can help you work through your inbox, research a question, or take care of a task using the apps you connect.</p>
      <p>Ask it to <a href="/login">find the emails that need your attention</a>, <a href="/login">plan your week</a>, or <a href="/login">look into something you’re curious about</a>. Keep your conversations, tasks, and connections together in your own workspace.</p>
      <a className="public-start" href="/login">Get started with Boop <span aria-hidden="true">↗</span></a>
    </main> : <main id="main" className="public-document">
      <div className="public-document-heading"><p className="public-eyebrow">Boop / {page === "privacy" ? "Privacy" : "Terms"}</p><h1>{page === "privacy" ? "Privacy policy" : "Terms of service"}</h1><p className="public-date">Last updated {UPDATED}</p></div>
      {page === "privacy" ? <>
        <p>This policy explains how Boop handles information when you sign in, connect apps, and ask your personal agent to do work. For privacy questions or requests, contact <Contact />.</p>
        <LegalSection title="Information Boop handles">
          <p>When you sign in with Google, Boop receives basic account information such as your name, email address, profile image, and account identifier. Boop also stores session information so you can stay signed in.</p>
          <p>When you use the agent, Boop processes your messages, task instructions, agent responses, task history, saved memories, preferences, and connected-account details. Operational records can include tool results, errors, usage, and timestamps. Depending on the messaging channel you use, Boop may receive your phone number, chat identifier, and message content.</p>
        </LegalSection>
        <LegalSection title="Connected apps and Google Workspace">
          <p>Signing in with Google is separate from connecting Google Workspace. App access is optional and depends on the permissions you approve. A Workspace connection can give Boop access to Gmail messages and labels; Calendar events; Tasks and task lists; Drive files; and the contents of Docs, Sheets, and Slides.</p>
          <p>Boop uses this access to answer your requests and perform actions such as summarizing emails, finding files, managing tasks, or updating documents. Where authorized, actions may read, create, edit, send, or delete information. Connected apps may also provide events used by automations you enable.</p>
        </LegalSection>
        <LegalSection title="How information is used and shared">
          <p>Boop uses information to run your workspace, provide agent responses, execute tasks and automations, remember relevant context, troubleshoot failures, and protect the service.</p>
          <p>Relevant messages, instructions, and connected-app data may be sent to the configured AI provider, including OpenAI, to process a task. Composio facilitates app authorization and tool execution and manages connected-app credentials. Convex provides database and authentication services, and AWS hosts application services. Enabled messaging providers process the messages needed to deliver that channel. These providers process information as part of delivering the service and under their applicable terms.</p>
          <p>Boop does not sell personal information or use Google Workspace data for advertising or to train generalized AI models. Google user data is used for the user-facing features you authorize, subject to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a> and its Limited Use requirements.</p>
          <p>Information may also be disclosed where legally required or necessary to investigate abuse, protect users, or maintain service security. Do not submit information you do not have permission to share.</p>
        </LegalSection>
        <LegalSection title="Storage and retention">
          <p>Account records, conversations, memories, task history, and integration metadata can be retained to support your workspace and ongoing tasks. Retention varies by record type and operational need; Boop does not currently promise a fixed deletion period. Service providers may maintain separate logs or backups under their own retention practices.</p>
          <p>Disconnecting an app stops future authorized access through that connection, but does not automatically erase data already stored in conversations, memories, task history, provider systems, or backups.</p>
        </LegalSection>
        <LegalSection title="Your choices and deletion requests">
          <p>You can disconnect integrations in Connections and revoke Google access in your <a href="https://myaccount.google.com/connections">Google Account’s third-party connections</a>. You can also sign out and manage available memory controls in your workspace.</p>
          <p>To request access, correction, export, or deletion of account information, email <Contact /> from the address associated with your account. We may need to verify your identity and may retain information required for legal, security, or operational purposes. If you enabled an automation, disable it when you no longer want it to run.</p>
        </LegalSection>
        <LegalSection title="Sessions and security">
          <p>Boop uses session cookies or browser storage for authentication and local preferences. Access controls separate authenticated workspaces. No online service can guarantee absolute security. Keep your accounts and integration permissions secure, and report suspected unauthorized access to <Contact />.</p>
        </LegalSection>
        <LegalSection title="International processing and updates">
          <p>Boop and its providers may process information in countries other than your own. Boop is not intended for children under 18. This policy may change as the service develops; the updated date appears above. Material changes to how connected Google data is used require an updated disclosure and any necessary consent.</p>
        </LegalSection>
      </> : <>
        <p>These terms govern your use of Boop’s website, dashboard, personal agent, and connected messaging features. By using Boop, you agree to these terms and acknowledge the <a href="/privacy">privacy policy</a>. Questions can be sent to <Contact />.</p>
        <LegalSection title="Your account">
          <p>You must be at least 18 and able to enter into an agreement to use Boop. Provide accurate account information, protect your sign-in credentials, and only connect accounts you own or are authorized to use. You are responsible for activity you authorize through your account.</p>
        </LegalSection>
        <LegalSection title="What the agent does">
          <p>Boop uses AI and connected tools to respond to messages and perform tasks. Available features depend on your configuration, connected services, permissions, and provider availability. Boop is under active development; features may change or become unavailable.</p>
          <p>Instructions and enabled automations can cause real actions in connected apps, including sending messages, changing files, or managing events and tasks. Give clear instructions, limit permissions to what you need, and review important outcomes. Do not assume every action will require an additional confirmation.</p>
        </LegalSection>
        <LegalSection title="AI output and your decisions">
          <p>AI responses can be inaccurate, incomplete, or delayed. Verify important information and external actions. Boop does not replace professional medical, legal, financial, or other advice, and must not be relied on for emergencies or decisions where errors could cause serious harm.</p>
        </LegalSection>
        <LegalSection title="Acceptable use">
          <p>Do not use Boop for unlawful activity, spam, fraud, harassment, unauthorized access, malware, or infringement of another person’s rights. Do not attempt to bypass security, access another user’s workspace, or abuse provider limits. Your use must comply with the rules of the services you connect.</p>
        </LegalSection>
        <LegalSection title="Your content and connected services">
          <p>You retain your rights in the content you provide. You authorize Boop and the providers needed to deliver its features to process that content and carry out your instructions. You must have the necessary rights and permissions for that processing.</p>
          <p>Google, Composio, AI providers, messaging providers, and other connected services have separate terms and availability. Boop is not endorsed by those providers. Revoking access or a provider restriction can prevent a task from completing.</p>
        </LegalSection>
        <LegalSection title="Fees and availability">
          <p>No subscription or purchase is created by reading these pages. If Boop introduces paid plans, their prices and conditions will be presented before purchase. Your third-party accounts, usage, mobile data, or services may have separate charges. Boop does not promise uninterrupted availability or a particular response time.</p>
        </LegalSection>
        <LegalSection title="Stopping use and suspension">
          <p>You can stop using Boop, disconnect apps, and request account deletion by contacting <Contact />. Disable any automations you no longer want. Access may be suspended to investigate abuse, protect security, comply with law, or respond to provider restrictions.</p>
        </LegalSection>
        <LegalSection title="Disclaimers and responsibility">
          <p>To the extent permitted by applicable law, Boop is provided “as is” and “as available,” without warranties of accuracy, availability, or fitness for a particular purpose. To that same extent, Boop’s operator is not liable for indirect or consequential losses caused by use of the service. These terms do not exclude rights or liabilities that cannot legally be excluded, including applicable consumer rights.</p>
        </LegalSection>
        <LegalSection title="Changes and contact">
          <p>These terms may be updated as Boop develops. Material changes will be communicated through the service or an appropriate account contact. If you do not agree to updated terms, stop using Boop. Contact <Contact /> about these terms or service issues.</p>
        </LegalSection>
      </>}
    </main>}
    <Footer />
  </div>;
}
