// Add new destinations here — no other code changes needed.
// Each key is a destination name used in API routes and forms.

// Fixed Google Sheets. Kept here as constants rather than env vars since they're
// stable, non-secret resources. Finance and hours live in separate spreadsheets.
export const SPREADSHEET_ID = '1wc9Vmz6isy-DGuo5UYELqFUWn-RtIFlCSULS3g8Bn60'
// The hours-tracking spreadsheet, and the gid of its hours tab.
export const HOURS_SPREADSHEET_ID = '1rMW2qPCCDzT-UsHZzmr2teF1ZcHWz5l3fKkK7QzqMUg'
export const HOURS_SHEET_GID = 1919073716
// The birthday sheet (Full Name / Team / Birthday), and the gid of its tab.
// Read by the service account (GOOGLE_CLIENT_EMAIL): it must be shared with
// that address as a Viewer, or stay "anyone with the link can view".
export const BIRTHDAY_SPREADSHEET_ID = '149xOHZ3At1nDISk6J0SpWls1XMssd_MnWCw2mSzIHKg'
export const BIRTHDAY_SHEET_GID = 2142793523

export const DRIVE_FOLDERS = {
  reimbursements: process.env.GOOGLE_DRIVE_FOLDER_ID,
}

export const SPREADSHEETS = {
  finance: SPREADSHEET_ID,
}

export function getDriveFolder(key) {
  const id = DRIVE_FOLDERS[key]
  if (!id) throw new Error(`No Drive folder configured for: ${key}`)
  return id
}

export function getSpreadsheet(key) {
  const id = SPREADSHEETS[key]
  if (!id) throw new Error(`No spreadsheet configured for: ${key}`)
  return id
}
