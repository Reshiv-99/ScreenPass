const indiaDateFormat = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Kolkata'})

export function releaseWindow(now = new Date()) {
  const today = indiaDateFormat.format(now)
  const offset = (days: number) => new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10)
  return {today, earliest: offset(-90), tomorrow: offset(1), latest: offset(90)}
}

export function isReleaseInWindow(date: string, {earliest, latest} = releaseWindow()) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= earliest && date <= latest
}

export type ReleaseDates = {
  results: {iso_3166_1: string; release_dates: {type: number; release_date: string}[]}[]
}

export function indiaTheatricalDate(releases?: ReleaseDates) {
  return releases?.results.find(region => region.iso_3166_1 === 'IN')?.release_dates
    .filter(date => date.type === 2 || date.type === 3)
    .map(date => date.release_date.slice(0, 10))
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort()[0]
}
