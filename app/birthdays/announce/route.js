import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { alertBotLog } from '@/lib/botlog'
import { BIRTHDAY_SPREADSHEET_ID, BIRTHDAY_SHEET_GID } from '@/lib/destinations'
import { findCelebrants, birthdayMessage, normalizeName } from '@/lib/birthdays'

// Announces the day's birthdays (from the birthday sheet) in #random, once a
// day at 9am Vancouver time. The cron fires 16:00 and 17:00 UTC (9am PT across
// DST) and the local-hour gate lets one through, like the hours reminder.
//
// Testing without waiting for 9am: `?dry=1` returns who would be announced
// without posting; `?date=MM-DD` pretends it's that day (and skips the hour
// gate). Both need the CRON_SECRET bearer if one is set.

const CHANNEL = 'random' // #random — the bot must be a member of it
const TZ = 'America/Vancouver'
const HOUR = 9

function authorized(req) {
  if (!process.env.CRON_SECRET) return true
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

function vancouverNow() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, month: 'numeric', day: 'numeric', hour: 'numeric', hour12: false })
      .formatToParts(new Date()).map((x) => [x.type, x.value]),
  )
  return { month: Number(p.month), day: Number(p.day), hour: Number(p.hour) }
}

async function readSheet() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const spreadsheetId = BIRTHDAY_SPREADSHEET_ID
  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  const sheet = meta.data.sheets?.find((s) => s.properties?.sheetId === BIRTHDAY_SHEET_GID) || meta.data.sheets?.[0]
  const tab = sheet?.properties?.title ?? 'Sheet1'
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:Z500` })
  return res.data.values || []
}

// Slack real names → user ids, so the message can @-mention people.
async function slackRoster(token) {
  const data = await fetch('https://slack.com/api/users.list', {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json())
  const roster = new Map()
  if (!data.ok) return roster // mentions are a nicety; names still post
  for (const m of data.members || []) {
    if (m.is_bot || m.deleted) continue
    for (const n of [m.profile?.real_name, m.real_name, m.profile?.display_name]) {
      const key = normalizeName(n)
      if (key && !roster.has(key)) roster.set(key, m.id)
    }
  }
  return roster
}

async function post(token, text) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: CHANNEL, text, unfurl_links: false }),
  })
  const data = await res.json()
  if (!data.ok) {
    const hint = data.error === 'not_in_channel' || data.error === 'channel_not_found' ? ` (invite the bot to #${CHANNEL})` : ''
    throw new Error(`Slack error: ${data.error}${hint}`)
  }
  return data
}

export async function GET(req) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === '1'
  const override = url.searchParams.get('date')?.match(/^(\d{1,2})-(\d{1,2})$/)

  const now = vancouverNow()
  const today = override ? { month: Number(override[1]), day: Number(override[2]) } : { month: now.month, day: now.day }
  if (!dry && !override && now.hour !== HOUR) {
    return NextResponse.json({ skipped: `not ${HOUR}:00 (${TZ}); now ${now.hour}:00` })
  }
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return NextResponse.json({ error: 'SLACK_BOT_TOKEN is not defined' }, { status: 500 })

  try {
    const celebrants = findCelebrants(await readSheet(), today)
    if (celebrants.length === 0) return NextResponse.json({ ok: true, date: today, celebrants })
    const text = birthdayMessage(celebrants, await slackRoster(token))
    if (dry) return NextResponse.json({ ok: true, dry: true, date: today, celebrants, text })
    const slack = await post(token, text)
    return NextResponse.json({ ok: true, date: today, celebrants, channel: CHANNEL, ts: slack.ts })
  } catch (err) {
    console.error('[birthdays/announce]', err)
    await alertBotLog(`birthday announcement failed: ${err.message}`)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
