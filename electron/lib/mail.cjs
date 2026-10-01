/**
 * App mail helper (password reset, etc.).
 * Uses the same SMTP_* env vars as Alertmanager (Gmail App Password supported).
 */
'use strict';

let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

function smtpConfigured() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USERNAME || process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '').trim();
  return Boolean(host && user && pass && nodemailer);
}

function _transport() {
  if (!nodemailer) {
    throw new Error('nodemailer is not installed');
  }
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587) || 587;
  const user = String(process.env.SMTP_USERNAME || process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '').trim();
  const secure = port === 465 || String(process.env.SMTP_SECURE || '') === '1';
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    ...(process.env.SMTP_HELLO
      ? { name: String(process.env.SMTP_HELLO).trim() }
      : {}),
  });
}

function _fromAddress() {
  return (
    String(process.env.SMTP_FROM || process.env.SMTP_USERNAME || process.env.SMTP_USER || '')
      .trim() || 'noreply@localhost'
  );
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string }} opts
 */
async function sendMail(opts) {
  if (!smtpConfigured()) {
    const err = new Error('SMTP is not configured (SMTP_HOST / SMTP_USERNAME / SMTP_PASSWORD)');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  const to = String(opts?.to || '').trim();
  if (!to) throw new Error('Mail "to" is required');
  const subject = String(opts?.subject || '').trim() || '(no subject)';
  const text = String(opts?.text || '');
  const html = opts?.html != null ? String(opts.html) : undefined;
  const transport = _transport();
  const info = await transport.sendMail({
    from: _fromAddress(),
    to,
    subject,
    text,
    ...(html ? { html } : {}),
  });
  return { messageId: info.messageId, accepted: info.accepted };
}

function maskEmail(email) {
  const s = String(email || '').trim();
  const at = s.indexOf('@');
  if (at <= 1) return '***';
  const user = s.slice(0, at);
  const domain = s.slice(at + 1);
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}***@${domain}`;
}

module.exports = {
  smtpConfigured,
  sendMail,
  maskEmail,
};
