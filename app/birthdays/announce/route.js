import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { alertBotLog } from '@/lib/botlog'
import { BIRTHDAY_SPREADSHEET_ID, BIRTHDAY_SHEET_GID, BIRTHDAY_SHEET_TITLE, BIRTHDAY_SLACK_IDS } from '@/lib/destinations'
import { findCelebrants, birthdayMessage, buildRoster } from '@/lib/birthdays'

// Room to wait out a Slack rate limit on users.list.
export const maxDuration = 60

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
  // By gid, then by tab name. Never fall back to another tab: the first tab
  // (Leadership) also has a Birthday column, so a wrong tab reads as "no
  // birthdays today" and nothing posts. Missing tab → error → #bot-logs.
  const tabs = meta.data.sheets || []
  const title = (s) => s.properties?.title?.trim().toLowerCase()
  const sheet =
    tabs.find((s) => s.properties?.sheetId === BIRTHDAY_SHEET_GID) ||
    tabs.find((s) => title(s) === BIRTHDAY_SHEET_TITLE.toLowerCase())
  if (!sheet) {
    throw new Error(`birthday sheet: no tab with gid ${BIRTHDAY_SHEET_GID} or named "${BIRTHDAY_SHEET_TITLE}" (tabs: ${tabs.map((s) => s.properties?.title).join(', ')})`)
  }
  const tab = sheet.properties.title
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab.replace(/'/g, "''")}'!A1:Z500` })
  return res.data.values || []
}

// Everyone on Slack, for @-mentions. users.list is rate-limited (429 +
// Retry-After), so wait and retry rather than quietly posting without tags.
async function slackMembers(token) {
  const members = []
  let cursor = ''
  do {
    const data = await slackGet(token, `users.list?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    members.push(...(data.members || []))
    cursor = data.response_metadata?.next_cursor || ''
  } while (cursor)
  return members
}

async function slackGet(token, path, tries = 3) {
  for (let i = 1; ; i++) {
    const res = await fetch(`https://slack.com/api/${path}`, { headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }))
    if (data.ok) return data
    if (data.error !== 'ratelimited' || i >= tries) throw new Error(`Slack ${path.split('?')[0]}: ${data.error}`)
    const wait = Math.min(Number(res.headers.get('retry-after')) || 5, 20)
    await new Promise((r) => setTimeout(r, wait * 1000))
  }
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
    // Mentions are worth retrying for but not worth skipping a birthday over:
    // if the roster can't load, post with plain names and say so in #bot-logs.
    let roster = buildRoster()
    let rosterError
    try {
      roster = buildRoster(await slackMembers(token))
    } catch (err) {
      rosterError = err.message
      if (!dry) await alertBotLog(`birthday announcement posted without @-mentions: ${err.message}`)
    }
    const text = birthdayMessage(celebrants, roster, BIRTHDAY_SLACK_IDS)
    if (dry) return NextResponse.json({ ok: true, dry: true, date: today, celebrants, text, rosterError })
    const slack = await post(token, text)
    return NextResponse.json({ ok: true, date: today, celebrants, channel: CHANNEL, ts: slack.ts })
  } catch (err) {
    console.error('[birthdays/announce]', err)
    await alertBotLog(`birthday announcement failed: ${err.message}`)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
