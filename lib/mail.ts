import { PUBLIC_DEMO } from "@/lib/public-demo";
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

function createSmtpConfig(port: number): SMTPTransport.Options {
  return {
    host: process.env.SMTP_HOST || '',
    port,
    secure: port === 465,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASSWORD || '',
    },
  };
}

function logDevelopment2FACode(to: string, code: string) {
  console.log('\n=============================================');
  console.log('[Development mode] 2FA email fallback');
  console.log(`To:   ${to}`);
  console.log(`Code: ${code}`);
  console.log('Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD for real email delivery.');
  console.log('=============================================\n');
}

function normalizeFromAddress(from: string): string {
  return from
    .trim()
    .replace(/\\"/g, '"')
    .replace(/^"([^"]+)"\s+<([^>]+)>$/, '$1 <$2>');
}

export async function send2FACode(to: string, code: string): Promise<void> {
  if (PUBLIC_DEMO) throw new Error('公開デモではメール認証を停止しています。本来は確認コードをメールで送信します。');
  /* Original integration below is retained for code review. */
  const isProduction = process.env.NODE_ENV === 'production';
  const hasSmtpConfig = Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD
  );

  if (!hasSmtpConfig) {
    if (isProduction) {
      throw new Error('認証メールの送信設定が不足しています。管理者に連絡してください。');
    }
    logDevelopment2FACode(to, code);
    return;
  }

  const preferredPort = Number(process.env.SMTP_PORT) || 587;
  const fallbackPort = preferredPort === 465 ? 587 : 465;
  const from = normalizeFromAddress(process.env.SMTP_FROM || 'Actlas <noreply@example.invalid>');
  const subject = '【Actlas】ログイン認証コードのお知らせ';
  const text = `
Actlasをご利用いただきありがとうございます。

以下の認証コードをログイン画面に入力してください。

認証コード: ${code}

※このコードの有効期限は5分間です。
※心当たりがない場合は、このメールを破棄してください。
`;

  const html = `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
  <h2 style="color: #333; text-align: center;">ログイン認証コード</h2>
  <p style="color: #555; line-height: 1.6;">
    Actlasをご利用いただきありがとうございます。<br>
    以下の認証コードをログイン画面に入力してください。
  </p>
  <div style="background-color: #f4f4f5; padding: 16px; text-align: center; border-radius: 8px; margin: 24px 0;">
    <span style="font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #111;">${code}</span>
  </div>
  <p style="color: #777; font-size: 14px;">
    ※このコードの有効期限は5分間です。<br>
    ※心当たりがない場合は、このメールを破棄してください。
  </p>
</div>
`;

  try {
    await sendMailWithFallback(
      [createSmtpConfig(preferredPort), createSmtpConfig(fallbackPort)],
      { from, to, subject, text, html }
    );
    console.log(`2FA code sent to ${to}`);
  } catch (error) {
    console.error('Error sending 2FA code email:', error);
    if (!isProduction) {
      logDevelopment2FACode(to, code);
      return;
    }
    throw new Error('認証メールの送信に失敗しました。管理者に連絡してください。');
  }
}

export async function sendEmailChangeCode(to: string, code: string): Promise<void> {
  if (PUBLIC_DEMO) throw new Error('公開デモではメール認証を停止しています。本来は確認コードをメールで送信します。');
  /* Original integration below is retained for code review. */
  const isProduction = process.env.NODE_ENV === 'production';
  const hasSmtpConfig = Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD
  );

  if (!hasSmtpConfig) {
    if (isProduction) {
      throw new Error('確認メールの送信設定が不足しています。管理者に連絡してください。');
    }
    logDevelopment2FACode(to, code);
    return;
  }

  const preferredPort = Number(process.env.SMTP_PORT) || 587;
  const fallbackPort = preferredPort === 465 ? 587 : 465;
  const from = normalizeFromAddress(process.env.SMTP_FROM || 'Actlas <noreply@example.invalid>');
  const subject = '【Actlas】メールアドレス変更確認コード';
  const text = `
Actlasのログインメールアドレス変更を受け付けました。

以下の確認コードをアカウント設定画面に入力してください。

確認コード: ${code}

※このコードの有効期限は15分間です。
※心当たりがない場合は、このメールを破棄してください。
`;

  const html = `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
  <h2 style="color: #333; text-align: center;">メールアドレス変更確認コード</h2>
  <p style="color: #555; line-height: 1.6;">
    Actlasのログインメールアドレス変更を受け付けました。<br>
    以下の確認コードをアカウント設定画面に入力してください。
  </p>
  <div style="background-color: #f4f4f5; padding: 16px; text-align: center; border-radius: 8px; margin: 24px 0;">
    <span style="font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #111;">${code}</span>
  </div>
  <p style="color: #777; font-size: 14px;">
    ※このコードの有効期限は15分間です。<br>
    ※心当たりがない場合は、このメールを破棄してください。
  </p>
</div>
`;

  try {
    await sendMailWithFallback(
      [createSmtpConfig(preferredPort), createSmtpConfig(fallbackPort)],
      { from, to, subject, text, html }
    );
    console.log(`Email change code sent to ${to}`);
  } catch (error) {
    console.error('Error sending email change code:', error);
    if (!isProduction) {
      logDevelopment2FACode(to, code);
      return;
    }
    throw new Error('確認メールの送信に失敗しました。管理者に連絡してください。');
  }
}

async function sendMailWithFallback(
  configs: SMTPTransport.Options[],
  message: EmailMessage
) {
  let lastError: unknown;

  try {
    const result = await sendWithResendApi(message);
    console.log('2FA email sent via Resend API', result);
    return result;
  } catch (error) {
    lastError = error;
    console.error('2FA email send failed via Resend API', { error });
  }

  for (const config of configs) {
    try {
      const transporter = nodemailer.createTransport(config);
      return await transporter.sendMail(message);
    } catch (error) {
      lastError = error;
      console.error('2FA email send failed via SMTP endpoint', {
        host: config.host,
        port: config.port,
        error,
      });
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('認証メールの送信に失敗しました');
}

async function sendWithResendApi(message: EmailMessage) {
  if (!process.env.SMTP_PASSWORD) {
    throw new Error('Resend API key is not configured.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SMTP_PASSWORD}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend API email send failed with status ${response.status}: ${body.slice(0, 300)}`);
  }

  return response.json().catch(() => ({}));
}
