/**
 * Transactional email templates.
 *
 * Inline styles and a table-free layout keep rendering predictable across
 * clients. Every template returns `{ subject, html, text }` so a plain-text
 * alternative is always sent alongside the HTML part.
 */

const BRAND = {
  name: 'InkFlow AI',
  dark: '#111827',
  primary: '#4f46e5',
  muted: '#6b7280',
  border: '#e5e7eb',
  background: '#f9fafb',
};

/** Escapes user-supplied values before interpolation into HTML. */
const escape = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const layout = ({ heading, body, cta, footnote }) => `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:${BRAND.background};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.dark};">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${BRAND.border};border-radius:12px;padding:32px;">
      <div style="font-size:18px;font-weight:700;margin-bottom:24px;">
        ${BRAND.name.split(' ')[0]} <span style="color:${BRAND.primary};">AI</span>
      </div>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${heading}</h1>
      <div style="font-size:15px;line-height:1.7;color:${BRAND.muted};">${body}</div>
      ${
        cta
          ? `<div style="margin:28px 0;">
               <a href="${cta.url}" style="display:inline-block;background:${BRAND.dark};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;">${cta.label}</a>
             </div>
             <p style="font-size:13px;color:${BRAND.muted};line-height:1.6;word-break:break-all;">
               If the button does not work, paste this link into your browser:<br />
               <a href="${cta.url}" style="color:${BRAND.primary};">${cta.url}</a>
             </p>`
          : ''
      }
      ${footnote ? `<p style="font-size:13px;color:${BRAND.muted};margin-top:24px;">${footnote}</p>` : ''}
      <hr style="border:none;border-top:1px solid ${BRAND.border};margin:28px 0 16px;" />
      <p style="font-size:12px;color:${BRAND.muted};margin:0;">
        © ${new Date().getFullYear()} ${BRAND.name}. Secure Editorial Environment.
      </p>
    </div>
  </body>
</html>`;

export const verifyEmailTemplate = ({ name, url, expiresInHours }) => ({
  subject: 'Verify your InkFlow AI account',
  html: layout({
    heading: 'Verify your identity',
    body: `<p>Hi ${escape(name)},</p>
           <p>Welcome to ${BRAND.name}. Confirm your email address to activate your editorial workspace.</p>`,
    cta: { url, label: 'Verify email address' },
    footnote: `This link expires in ${expiresInHours} hours. If you did not create this account, you can safely ignore this email.`,
  }),
  text: `Hi ${name},

Welcome to ${BRAND.name}. Verify your email address to activate your workspace:

${url}

This link expires in ${expiresInHours} hours. If you did not create this account, ignore this email.`,
});

/**
 * Password reset. Carries both credentials the app accepts: the 6-digit code
 * to type, and the one-click link.
 */
export const passwordResetTemplate = ({ name, url, code, expiresInMinutes }) => ({
  subject: `${code} is your InkFlow AI password reset code`,
  html: layout({
    heading: 'Reset your password',
    body: `<p>Hi ${escape(name)},</p>
           <p>We received a request to reset the password for your ${BRAND.name} account. Enter this code to continue:</p>
           <div style="margin:24px 0;padding:18px;text-align:center;background:${BRAND.background};border:1px solid ${BRAND.border};border-radius:10px;">
             <div style="font-size:32px;font-weight:700;letter-spacing:10px;font-family:'SFMono-Regular',Consolas,monospace;color:${BRAND.dark};">${escape(code)}</div>
             <div style="margin-top:8px;font-size:12px;color:${BRAND.muted};">Expires in ${expiresInMinutes} minutes</div>
           </div>
           <p>Or reset it in one click:</p>`,
    cta: { url, label: 'Reset password' },
    footnote: `The code and link each work once. If you did not request a reset, your password remains unchanged and no action is needed.`,
  }),
  text: `Hi ${name},

Your ${BRAND.name} password reset code is: ${code}

Or use this link instead:
${url}

The code and link each work once and expire in ${expiresInMinutes} minutes. If you did not request this, your password is unchanged.`,
});

export const passwordChangedTemplate = ({ name }) => ({
  subject: 'Your InkFlow AI password was changed',
  html: layout({
    heading: 'Your password was changed',
    body: `<p>Hi ${escape(name)},</p>
           <p>The password for your ${BRAND.name} account was just changed, and all other active sessions have been signed out.</p>`,
    footnote: 'If this was not you, reset your password immediately and contact support.',
  }),
  text: `Hi ${name},

The password for your ${BRAND.name} account was just changed and all other sessions were signed out.

If this was not you, reset your password immediately and contact support.`,
});

export const welcomeTemplate = ({ name, url }) => ({
  subject: 'Welcome to InkFlow AI',
  html: layout({
    heading: 'Your workspace is ready',
    body: `<p>Hi ${escape(name)},</p>
           <p>Your email is verified and your editorial workspace is live. Draft with the AI Writer, organise research into collections, and track how your work performs.</p>`,
    cta: { url, label: 'Open your dashboard' },
  }),
  text: `Hi ${name},

Your ${BRAND.name} workspace is ready: ${url}`,
});

export const teamInviteTemplate = ({ name, inviterName, workspaceName, role, url }) => ({
  subject: `${inviterName} invited you to ${workspaceName} on InkFlow AI`,
  html: layout({
    heading: `You have been invited as ${escape(role)}`,
    body: `<p>Hi ${escape(name)},</p>
           <p><strong>${escape(inviterName)}</strong> invited you to collaborate on <strong>${escape(workspaceName)}</strong> in ${BRAND.name} as a <strong>${escape(role)}</strong>.</p>`,
    cta: { url, label: 'Accept invitation' },
    footnote: 'If you do not have an account yet, you will be prompted to create one with this email address.',
  }),
  text: `Hi ${name},

${inviterName} invited you to collaborate on ${workspaceName} in ${BRAND.name} as a ${role}.

Accept the invitation: ${url}`,
});

export default {
  verifyEmailTemplate,
  passwordResetTemplate,
  passwordChangedTemplate,
  welcomeTemplate,
  teamInviteTemplate,
};
