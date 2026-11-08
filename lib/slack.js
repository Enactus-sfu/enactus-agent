import { getSetting } from './settings'
import { SPREADSHEET_ID } from './destinations'

const CHANNELS = {
  agent_test: 'agent-test',           // #agent-test
  marketing_execs: 'marketing-execs', // #marketing-execs
  finance: 'finance',                 // #finance
}

// Resolves where a notification should post. An explicit channel key/name wins;
// otherwise we read the channel picked in the app (Settings → financeChannel),
// falling back to #agent-test so notifications never silently vanish.
async function resolveChannel(settingKey, explicit, fallbackKey = 'agent_test') {
  if (explicit) return CHANNELS[explicit] ?? explicit
  try {
    const v = await getSetting(settingKey)
    if (v && typeof v === 'object' && v.id) return v.id
    if (typeof v === 'string' && v) return v
  } catch (err) {
    console.warn(`[slack] could not resolve channel for ${settingKey}:`, err?.message ?? err)
  }
  return CHANNELS[fallbackKey] ?? CHANNELS.agent_test
}

async function postMessage(channel, blocks) {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) throw new Error('SLACK_BOT_TOKEN is not defined')

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, blocks }),
  })

  const data = await res.json()
  if (!data.ok) throw new Error(`Slack error: ${data.error}`)
}

export async function postToSlack({ mode, message, name, email, fileUrls = [], channel = 'agent_test' }) {
  const slackChannel = CHANNELS[channel] ?? CHANNELS.agent_test

  const blocks = mode === 'message'
    ? [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Debug message:*\n${message}` },
        },
      ]
    : [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'New Enactus Submission', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Name:*\n${name}` },
            { type: 'mrkdwn', text: `*Email:*\n${email}` },
          ],
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Message:*\n${message}` },
        },
        ...(fileUrls.length > 0
          ? [{
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Files:*\n${fileUrls.map((url, i) => `<${url}|Attachment ${i + 1}>`).join('\n')}`,
              },
            }]
          : []),
        { type: 'divider' },
      ]

  await postMessage(slackChannel, blocks)
}

export async function postFinanceToSlack({ type, item, team, date, amount, etransferName, etransferEmail, receiptUrl, channel }) {
  const isReimbursement = type === 'reimbursement'
  const title = isReimbursement ? '🧾 New Reimbursement Request' : '💰 New Money Request'

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: title, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Item:*\n${item}` },
        { type: 'mrkdwn', text: `*Project/Portfolio:*\n${team}` },
        { type: 'mrkdwn', text: `*Amount:*\n$${amount}` },
        { type: 'mrkdwn', text: `*Date:*\n${date}` },
        { type: 'mrkdwn', text: `*E-transfer to:*\n${etransferName}` },
        { type: 'mrkdwn', text: `*E-transfer email:*\n${etransferEmail}` },
      ],
    },
    ...(receiptUrl
      ? [{
          type: 'section',
          text: { type: 'mrkdwn', text: `*Receipt:*\n<${receiptUrl}|View receipt>` },
        }]
      : []),
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `<https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit|View in spreadsheet>`,
        },
      ],
    },
    { type: 'divider' },
  ]

  const target = await resolveChannel('financeChannel', channel, 'finance')
  await postMessage(target, blocks)
}
