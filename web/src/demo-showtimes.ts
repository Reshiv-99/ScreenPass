const indiaOffsetMs = 330 * 60_000

export function demoShowtimes(now = new Date()) {
  const local = new Date(now.getTime() + indiaOffsetMs)
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  return Array.from({length: 4}, (_, day) => [690, 900, 1140].map(minutes =>
    new Date(today + (day * 1440 + minutes) * 60_000 - indiaOffsetMs),
  )).flat().filter(start => start > now).map(start => start.toISOString())
}
