// The birthday sheet, read into "who has a birthday today". Pure: the route
// fetches the rows and the Slack roster, this decides. Only the month and day
// of a birthday matter, so the year is ignored — which also forgives the
// sheet's typos ("20026-01-23", "2025-02-23").

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

// "2005-07-01" → { month: 7, day: 1 }; "July 23, " → { month: 7, day: 23 };
// "7/23/2005" → { month: 7, day: 23 }; anything else → null.
export function parseMonthDay(cell) {
  const s = String(cell ?? '').trim()
  if (!s) return null
  let m
  if ((m = s.match(/^\d{1,5}-(\d{1,2})-(\d{1,2})/))) return check(+m[1], +m[2])
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})/))) return check(+m[1], +m[2])
  if ((m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2})/))) {
    const month = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()]
    return month ? check(month, +m[2]) : null
  }
  return null
}

function check(month, day) {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day } : null
}

// For matching the sheet's names to Slack real names: case, accents, extra
// spaces and punctuation don't count.
export function normalizeName(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim()
}

// rows: the sheet's values, header row included (columns found by header
// text, so the sheet can be rearranged). Returns [{ name, team }] for the day.
export function findCelebrants(rows, { month, day }) {
  const header = (rows[0] || []).map((h) => String(h ?? '').toLowerCase())
  const nameCol = header.findIndex((h) => h.includes('name'))
  const dateCol = header.findIndex((h) => h.includes('birthday') || h.includes('birth'))
  const teamCol = header.findIndex((h) => h.includes('team') || h.includes('department'))
  if (nameCol < 0 || dateCol < 0) throw new Error('birthday sheet: could not find the name and birthday columns in row 1')
  return rows.slice(1).flatMap((r) => {
    const name = String(r[nameCol] ?? '').trim()
    const bd = parseMonthDay(r[dateCol])
    if (!name || !bd || bd.month !== month || bd.day !== day) return []
    return [{ name, team: teamCol >= 0 ? String(r[teamCol] ?? '').trim() : '' }]
  })
}

// "<@U123>" when the person is on Slack under that name, else just the name.
export function mention(name, roster) {
  const id = roster.get(normalizeName(name))
  return id ? `<@${id}>` : `*${name}*`
}

export function birthdayMessage(celebrants, roster) {
  const who = celebrants.map((c) => mention(c.name, roster))
  const list = who.length === 1 ? who[0] : `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}`
  return `:birthday: Happy birthday, ${list}! :tada: Have a great one, from all of us at Enactus SFU.`
}
