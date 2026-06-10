const RESEND_URL = 'https://api.resend.com/emails';

export const emailConfigured = () =>
  Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_TO && process.env.ALERT_EMAIL_FROM);

export async function sendEmail({ subject, html, text }) {
  if (!emailConfigured()) {
    return { ok: false, skipped: true, message: 'Email alert belum dikonfigurasi.' };
  }

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.ALERT_EMAIL_FROM,
      to: process.env.ALERT_EMAIL_TO.split(',').map(email => email.trim()).filter(Boolean),
      subject,
      html,
      text
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Resend email error ${res.status}`);
  return { ok: true, data };
}
