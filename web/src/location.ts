export type City = {slug: string; name: string}

export const normalizeCityName = (name: string) => name.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '')
export function chooseCity(name: string, presets: City[]): City {
  const key = normalizeCityName(name)
  return presets.find(city => normalizeCityName(city.name) === key)
    ?? {slug: 'custom-' + Array.from(key).slice(0, 12).join(''), name}
}

export function readCityPreference(): string | City {
  const saved = localStorage.getItem('cinevault.city') || 'delhi'
  if (saved.startsWith('{')) {
    try {
      const city: Partial<City> = JSON.parse(saved)
      if (typeof city.slug === 'string' && /^custom-[\p{L}\p{N}]+$/u.test(city.slug)
        && city.slug.length <= 32 && typeof city.name === 'string' && city.name.trim() && city.name.length <= 80) {
        return {slug: city.slug, name: city.name}
      }
    } catch { /* Ignore an invalid saved preference. */ }
    return 'delhi'
  }
  return saved
}

export async function lookupCity(coords: Pick<GeolocationCoordinates, 'latitude' | 'longitude'>, signal: AbortSignal) {
  const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client')
  url.search = new URLSearchParams({
    latitude: coords.latitude.toFixed(3),
    longitude: coords.longitude.toFixed(3),
    localityLanguage: 'en',
  }).toString()
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(7000)]),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })
  if (!response.ok) throw new Error('City lookup failed.')
  const result: {city?: unknown; locality?: unknown; lookupSource?: unknown} = await response.json()
  if (result.lookupSource === 'ipGeolocation') throw new Error('City could only be estimated from IP.')
  for (const value of [result.city, result.locality]) {
    if (typeof value !== 'string') continue
    const name = value.trim()
    if (name.length <= 80 && /\p{L}/u.test(name)) return name
  }
  throw new Error('City name unavailable.')
}
