import nodemailer from 'nodemailer';
import { logger } from '../logger.js';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || '';

export const sendPasswordReset = async ({ to, resetUrl }) => {
  if (!SMTP_HOST) {
    // Dev-fallback: ссылка попадает в лог только здесь
    logger.info('mail dev fallback', { to, resetUrl });
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
  });

  await transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject: 'Сброс пароля',
    text: `Для сброса пароля перейдите по ссылке: ${resetUrl}`
  });
};