// The Sent copy: right folder, and the same message that was delivered.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import MailComposer from 'nodemailer/lib/mail-composer'
import { pickSentFolder } from '@/lib/outreach/transport'

test('the Sent folder is found by its server flag, else by its usual name', () => {
  assert.equal(pickSentFolder([{ path: 'INBOX', name: 'INBOX' }, { path: 'Sent Items', name: 'Sent Items', specialUse: '\Sent' }]), 'Sent Items')
  assert.equal(pickSentFolder([{ path: 'INBOX', name: 'INBOX' }, { path: 'Sent', name: 'Sent' }]), 'Sent')
  assert.equal(pickSentFolder([{ path: 'INBOX', name: 'INBOX' }, { path: 'Drafts', name: 'Drafts' }]), null)
})

test('the filed copy carries the same Message-ID and the attachment', async () => {
  const msg = {
    from: '"KAASEB" <info@kaaseb.sa>', to: 'info@example.com', subject: 'Natural Stone Supply',
    text: 'السادة المحترمين', messageId: '<abc123@kaaseb.sa>', date: new Date('2026-11-07T10:00:00Z'),
    attachments: [{ filename: 'Abraj-Profile.pdf', content: Buffer.from('%PDF-1.4 test') }],
  }
  const raw = (await new MailComposer(msg).compile().build()).toString()
  assert.ok(raw.includes('Message-ID: <abc123@kaaseb.sa>'))
  assert.ok(raw.includes('Abraj-Profile.pdf'))
  assert.ok(/Subject: Natural Stone Supply/.test(raw))
})
