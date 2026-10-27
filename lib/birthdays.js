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

// "Phuc Duy Khang Nguyen" → "phuc nguyen": first and last word, for Slack
// profiles that leave out middle names.
export function firstLast(s) {
  const w = normalizeName(s).split(' ').filter(Boolean)
  return w.length >= 2 ? `${w[0]} ${w[w.length - 1]}` : ''
}

// Slack members (users.list) → name lookups. Exact names win. First + last
// name is a fallback kept only when exactly one member has it, so a shared
// name never tags the wrong person.
export function buildRoster(members = []) {
  const exact = new Map()
  const loose = new Map()
  for (const m of members) {
    if (m.is_bot || m.deleted || m.id === 'USLACKBOT') continue
    const names = [m.profile?.real_name, m.real_name, m.profile?.display_name]
    for (const n of names) {
      const k = normalizeName(n)
      if (k && !exact.has(k)) exact.set(k, m.id)
    }
    for (const k of new Set(names.map(firstLast).filter(Boolean))) {
      loose.set(k, loose.has(k) && loose.get(k) !== m.id ? null : m.id)
    }
  }
  return { exact, loose }
}

// "<@U123>" when the person is on Slack, else their name in bold. `pairs`
// (sheet name → Slack user id) covers people whose Slack name is different.
export function mention(name, roster, pairs = {}) {
  const key = normalizeName(name)
  const paired = Object.entries(pairs).find(([n]) => normalizeName(n) === key)?.[1]
  const id = paired || roster.exact.get(key) || roster.loose.get(firstLast(name))
  return id ? `<@${id}>` : `*${name}*`
}

export function birthdayMessage(celebrants, roster, pairs = {}) {
  const who = celebrants.map((c) => mention(c.name, roster, pairs))
  const list = who.length === 1 ? who[0] : `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}`
  return `:birthday: Happy birthday, ${list}! :tada: Have a great one, from all of us at Enactus SFU.`
}
