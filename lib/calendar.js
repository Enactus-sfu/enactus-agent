import { google } from 'googleapis'

let cachedAuth = null

function getAuth() {
  if (cachedAuth) return cachedAuth
  cachedAuth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    // calendar.events = read + create/update/delete events (needed to write).
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
  })
  return cachedAuth
}

function getCalendar() {
  return google.calendar({ version: 'v3', auth: getAuth() })
}

// Create an event on the team calendar. Requires the calendar.events scope and
// the calendar shared with the service account ("Make changes to events").
// start/end accept anything Date can parse (ISO recommended). Returns the new
// event's id + link.
export async function createCalendarEvent({ summary, start, end, attendees = [], description = '', location = '', timeZone = 'America/Vancouver' } = {}) {
  const calendarId = process.env.GOOGLE_CALENDAR_ID
  if (!calendarId) throw new Error('GOOGLE_CALENDAR_ID is not set.')
  if (!summary || !start || !end) throw new Error('summary, start, and end are required.')

  const startDate = new Date(start)
  const endDate = new Date(end)
  if (isNaN(startDate) || isNaN(endDate)) throw new Error('start/end are not valid dates.')

  const calendar = getCalendar()
  const { data } = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary,
      description,
      location,
      start: { dateTime: startDate.toISOString(), timeZone },
      end: { dateTime: endDate.toISOString(), timeZone },
      attendees: (attendees || []).filter(Boolean).map((email) => ({ email })),
    },
  })
  return { id: data.id, htmlLink: data.htmlLink, summary: data.summary, start: data.start, end: data.end }
}
