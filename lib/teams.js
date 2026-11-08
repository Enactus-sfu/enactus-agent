// Every reimbursement is filed against one project or portfolio, so Finance can
// filter the sheet into a tab per team. Mirrors https://www.enactussfu.ca/team:
// each director owns a portfolio, each project is its own team.
// Add or rename a team here — the form, API and sheet all read this list.
export const PROJECTS = ['Unify', 'SKYES', 'Alara', 'Nourish', 'NextSpark', 'Renovo', 'Second Savour']

export const PORTFOLIOS = [
  'Internal',
  'Finance',
  'Media',
  'Marketing Strategy',
  'Design',
  'Events',
  'External',
  'Web & Tech',
  'Exec / General',
]

export const TEAMS = [...PROJECTS, ...PORTFOLIOS]
