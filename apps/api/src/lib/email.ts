import { Resend } from "resend";
import { maskEmail } from "./mask";

export type CodePurpose =
  "email-verification" | "forget-password" | "sign-in" | "change-email";

export interface InviteMail {
  to: string;
  firmName: string;
  inviterName: string;
  role: string;
}

export interface EmailSender {
  sendCode(to: string, code: string, purpose: CodePurpose): Promise<void>;
  sendInvite(to: string, invite: InviteMail): Promise<void>;
}

const inviteLine = (i: InviteMail) =>
  `${i.inviterName} invited you to ${i.firmName} on Hisaab as ${i.role}. Open Hisaab, sign up or log in with this email address, and accept the invitation. It is valid for 7 days.`;

const SUBJECT: Record<CodePurpose, string> = {
  "email-verification": "Your Hisaab verification code",
  "forget-password": "Reset your Hisaab password",
  "sign-in": "Your Hisaab sign-in code",
  "change-email": "Confirm your new email for Hisaab",
};

const PURPOSE_LINE: Record<CodePurpose, string> = {
  "email-verification":
    "Use this code to verify your email and finish creating your account.",
  "forget-password": "Use this code to set a new password.",
  "sign-in": "Use this code to sign in.",
  "change-email": "Use this code to confirm your new email address.",
};

const html = (code: string, purpose: CodePurpose) => `
<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px">
  <p style="font-size:16px;color:#111">${PURPOSE_LINE[purpose]}</p>
  <p style="font-size:34px;letter-spacing:8px;font-weight:700;color:#111;margin:24px 0">${code}</p>
  <p style="font-size:13px;color:#666">The code works for 5 minutes. If you didn't ask for it, ignore this email.</p>
</div>`;

/** Sends codes through Resend. */
export function resendSender(apiKey: string, from: string): EmailSender {
  const resend = new Resend(apiKey);
  return {
    async sendCode(to, code, purpose) {
      const { error } = await resend.emails.send({
        from,
        to,
        subject: SUBJECT[purpose],
        html: html(code, purpose),
        text: `${PURPOSE_LINE[purpose]}\n\nYour code: ${code}\n\nIt works for 5 minutes.`,
      });
      if (error)
        throw new Error(`Resend could not send the email: ${error.message}`);
    },
    async sendInvite(to, invite) {
      const { error } = await resend.emails.send({
        from,
        to,
        subject: `${invite.inviterName} invited you to ${invite.firmName} on Hisaab`,
        text: inviteLine(invite),
      });
      if (error)
        throw new Error(`Resend could not send the email: ${error.message}`);
    },
  };
}

/** For local development: prints the code in the server log instead of sending an email. */
export function logSender(log: (message: string) => void): EmailSender {
  return {
    async sendCode(to, code, purpose) {
      log(`[dev email] ${purpose} code for ${maskEmail(to)}: ${code}`);
    },
    async sendInvite(to, invite) {
      log(`[dev email] invitation for ${maskEmail(to)}: ${inviteLine(invite)}`);
    },
  };
}

/** For tests: remembers what was "sent" so a test can read the code. */
export function memorySender() {
  const sent: { to: string; code: string; purpose: CodePurpose }[] = [];
  const invites: InviteMail[] = [];
  const sender: EmailSender = {
    async sendCode(to, code, purpose) {
      sent.push({ to, code, purpose });
    },
    async sendInvite(_to, invite) {
      invites.push(invite);
    },
  };
  return {
    sender,
    sent,
    invites,
    lastCode: (to: string) => sent.filter((m) => m.to === to).at(-1)?.code,
  };
}
