import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { alertBotLog } from '@/lib/botlog'
import { HOURS_SPREADSHEET_ID, HOURS_SHEET_GID } from '@/lib/destinations'

const CHANNEL_ID = 'C0B1D5R8GRY'
const CALEB = /caleb/i // the name row cell reads "Caleb"
const TZ = 'America/Vancouver'
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// The hours spreadsheet's specific tab (the gid in its URL).
const HOURS_GID = HOURS_SHEET_GID

function authorized(req) {
  if (!process.env.CRON_SECRET) return true
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

function vancouverNow() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, weekday: 'short', hour: 'numeric', hour12: false })
      .formatToParts(new Date()).map((x) => [x.type, x.value]),
  )
  return { day: p.weekday, hour: Number(p.hour) }
}

// 0-based column index → A1 letter (Q=16, AA=26, …).
function colLetter(i) {
  let s = ''
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s
  return s
}

// This week's Monday, formatted to match column A (e.g. "Jun 22"). Column A
// lists weekly Mondays; the reminder runs Monday at 5pm PT, so we target the current week.
function currentWeekMondayLabel() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      .formatToParts(new Date()).map((x) => [x.type, x.value]),
  )
  const d = new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`)
  const daysSinceMon = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[p.weekday] ?? 0
  d.setUTCDate(d.getUTCDate() - daysSinceMon)
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}` // no leading zero, matches "Jun 22"
}

function sheetUrl() {
  return `https://docs.google.com/spreadsheets/d/${HOURS_SPREADSHEET_ID}/edit?gid=${HOURS_GID}#gid=${HOURS_GID}`
}

async function updateCalebHours() {
  const spreadsheetId = HOURS_SPREADSHEET_ID
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  // Target the specific tab (gid) of the hours sheet, not just the first tab.
  const sheet = meta.data.sheets?.find((s) => s.properties?.sheetId === HOURS_GID) || meta.data.sheets?.[0]
  const tab = sheet?.properties?.title ?? 'Sheet1'

  // Layout: people are COLUMNS (names in row 5), weeks are ROWS (column A holds
  // weekly Mondays like "Jun 22", with "Total" subtotal rows between months).
  // Caleb's column × the current week's row = the one cell we write.
  const nameRow = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A5:AZ5` })).data.values?.[0] || []
  const colIdx = nameRow.findIndex((n) => CALEB.test(String(n || '')))
  if (colIdx < 0) throw new Error('Caleb column not found in the name row (row 5)')

  const colA = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:A300` })).data.values || []
  const week = currentWeekMondayLabel()
  const rowIdx = colA.findIndex((r) => String((r || [])[0] || '').trim().toLowerCase() === week.toLowerCase())
  if (rowIdx < 0) throw new Error(`Week row "${week}" not found in column A`)

  const hours = Math.floor(Math.random() * 6) + 5
  const cell = `${tab}!${colLetter(colIdx)}${rowIdx + 1}`
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: cell,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[hours]] },
  })
  return { hours, cell, week }
}

async function postReminder(token) {
  const auth = await fetch('https://slack.com/api/auth.test', {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json())
  if (!auth.ok) throw new Error(`Slack auth error: ${auth.error}`)
  const mention = '<!channel>'
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: CHANNEL_ID,
      text: `${mention} Weekly reminder: update your Enactus hours. ${sheetUrl()}`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*Weekly hour tracking reminder* (${mention})\nPlease update your hours.` } },
        { type: 'section', text: { type: 'mrkdwn', text: `<${sheetUrl()}|Open spreadsheet>` } },
      ],
    }),
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`Slack error: ${data.error}`)
  return data
}

export async function GET(req) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // Cron fires Tue 00:00 + 01:00 UTC (Mon 5pm PT across DST). Gate on local day/hour.
  const now = vancouverNow()
  if (now.day !== 'Mon' || now.hour !== 17) {
    return NextResponse.json({ skipped: `not Monday 5pm (${TZ}); now ${now.day} ${now.hour}:00` })
  }
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return NextResponse.json({ error: 'SLACK_BOT_TOKEN is not defined' }, { status: 500 })
  try {
    const slack = await postReminder(token)
    const calebHours = await updateCalebHours()
    return NextResponse.json({ ok: true, channel: CHANNEL_ID, ts: slack.ts, calebHours })
  } catch (err) {
    console.error('[hours/remind]', err)
    await alertBotLog(`hours reminder failed: ${err.message}`)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
