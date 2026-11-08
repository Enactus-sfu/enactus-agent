import { google } from 'googleapis'
import { getSpreadsheet } from './destinations.js'

let cachedAuth = null
let cachedSheetName = null

function getAuth() {
  if (cachedAuth) return cachedAuth
  cachedAuth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return cachedAuth
}

function escapeForFormula(str) {
  return str.replace(/"/g, '""')
}

async function getSheetName(sheets, spreadsheetId) {
  if (cachedSheetName) return cachedSheetName
  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  cachedSheetName = meta.data.sheets?.[0]?.properties?.title ?? 'Sheet1'
  return cachedSheetName
}

// The Project/Portfolio column (J) was added after the sheet was set up, so
// write its header the first time it's missing. The header row is the one
// whose column A reads "Submission Date" (rows above it are blank).
const TEAM_HEADER = 'Project/Portfolio'
let teamHeaderChecked = false

async function ensureTeamHeader(sheets, spreadsheetId, sheetName) {
  if (teamHeaderChecked) return
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:J20`,
  })
  const rows = data.values ?? []
  const index = rows.findIndex((r) => (r[0] ?? '').trim().toLowerCase() === 'submission date')
  if (index !== -1 && !(rows[index][9] ?? '').trim()) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!J${index + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[TEAM_HEADER]] },
    })
  }
  teamHeaderChecked = true
}

export async function appendFinanceRow(data, destination = 'finance') {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const spreadsheetId = getSpreadsheet(destination)
  const sheetName = await getSheetName(sheets, spreadsheetId)
  await ensureTeamHeader(sheets, spreadsheetId, sheetName)

  const label = escapeForFormula(`${data.item}-${data.etransferName.split(' ')[0].toLowerCase()}`)
  const url = escapeForFormula(data.receiptUrl || '')

  // Submission date = when the request is filed (Vancouver time, ISO format).
  const submissionDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })

  const row = [
    submissionDate,
    data.item,
    data.date,
    data.amount,
    data.type === 'reimbursement' ? 'FALSE' : 'N/A',
    data.receiptUrl ? `=HYPERLINK("${url}","${label}")` : '',
    data.etransferName,
    data.amount,
    data.etransferEmail,
    data.team,
  ]

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:J`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  })
}
