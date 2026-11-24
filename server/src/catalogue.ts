import { HttpError } from './http'
import { indiaTheatricalDate, isReleaseInWindow, releaseWindow, type ReleaseDates } from './releases'

export const cities = [
  ['delhi', 'Delhi', 28.6139, 77.209], ['mumbai', 'Mumbai', 19.076, 72.8777],
  ['bengaluru', 'Bengaluru', 12.9716, 77.5946], ['hyderabad', 'Hyderabad', 17.385, 78.4867],
  ['chennai', 'Chennai', 13.0827, 80.2707], ['kolkata', 'Kolkata', 22.5726, 88.3639],
  ['pune', 'Pune', 18.5204, 73.8567], ['jaipur', 'Jaipur', 26.9124, 75.7873],
  ['chandigarh', 'Chandigarh', 30.7333, 76.7794], ['ahmedabad', 'Ahmedabad', 23.0225, 72.5714],
  ['gurugram', 'Gurugram', 28.4595, 77.0266], ['noida', 'Noida', 28.5355, 77.391],
  ['panipat', 'Panipat', 29.3909, 76.9635],
].map(([slug, name, lat, lng]) => ({ slug: String(slug), name: String(name), lat: Number(lat), lng: Number(lng) }))

export const genres = [
  { id: 878, name: 'Sci-fi' }, { id: 28, name: 'Action' }, { id: 12, name: 'Adventure' },
  { id: 18, name: 'Drama' }, { id: 53, name: 'Thriller' }, { id: 16, name: 'Animation' },
]
export interface Movie {
  id: number
  title: string
  poster_path: string | null
  backdrop_path: string | null
  overview: string
  release_date: string
  india_release_date?: string
  vote_average: number
  genre_ids: number[]
  genres?: {id: number; name: string}[]
  runtime?: number
  credits?: {cast: {id: number; name: string; character: string}[]; crew: {id: number; name: string; job: string}[]}
  videos?: {results: {id: string; site: string; key: string; type: string}[]}
}

function sample(id: number, title: string, poster_path: string, backdrop_path: string | null, release_date: string, runtime: number, vote_average: number, genre_ids: number[], overview: string, trailer: string): Movie {
  return {id, title, poster_path, backdrop_path, release_date, runtime, vote_average, genre_ids, overview, videos: {results: [{id: trailer, key: trailer, site: 'YouTube', type: 'Trailer'}]}}
}

export const samples = [
  sample(693134, 'Dune: Part Two', '/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg', '/dune-hero.jpg', '2024-03-01', 166, 8.2, [878, 12], 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family. Facing a choice between love and the fate of the universe, he must prevent a terrible future only he can foresee.', 'Way9Dexny3w'),
  sample(872585, 'Oppenheimer', '/oppenheimer.jpg', '/fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg', '2023-07-21', 180, 8.1, [18], 'Physicist J. Robert Oppenheimer leads the Manhattan Project, confronting the consequences of a discovery that will change the world.', 'uYPbbksJxIg'),
  sample(157336, 'Interstellar', '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', '/xJHokMbljvjADYdit5fK5VQsXEG.jpg', '2014-11-07', 169, 8.5, [878, 12, 18], 'A former pilot leads a team of explorers beyond our galaxy in search of a new home for humanity.', 'zSWdZVtXT7E'),
  sample(76341, 'Mad Max: Fury Road', '/8tZYtuWezp8JbcsvHYO0O46tFbo.jpg', '/nlCHUWjY9XWbuEUQauCBgnY8ymF.jpg', '2015-05-15', 121, 7.6, [28, 12, 878], 'In a post-apocalyptic wasteland, Furiosa and Max flee a tyrant on a desperate chase across the desert.', 'hEJnMQG9ev8'),
  sample(569094, 'Spider-Man: Across the Spider-Verse', '/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg', '/4HodYYKEIsGOdinkGi2Ucz6X9i0.jpg', '2023-06-02', 140, 8.3, [16, 28, 12], 'Miles Morales travels across the multiverse and faces a new threat alongside a team of Spider-People.', 'cqGjhVJWtEg'),
  sample(155, 'The Dark Knight', '/qJ2tW6WMUDux911r6m7haRef0WH.jpg', null, '2008-07-18', 152, 8.5, [28, 18, 53], 'Batman, Gordon and Harvey Dent work to protect Gotham from the Joker.', 'EXeTwQWrcwY'),
]

const lists: Record<string, string> = { trending: '/trending/movie/week', popular: '/movie/popular', 'now-playing': '/movie/now_playing', upcoming: '/movie/upcoming', search: '/search/movie' }
const cache = new Map<string, {value: unknown; expires: number}>()
let retryAfter = 0
const pending = new Map<string, Promise<unknown>>()

const catalogueMovies = new Map<number, Movie>()

async function tmdb<T>(path: string, params: Record<string, string> = {}, detail = false): Promise<T | null> {
  const token = process.env.TMDB_ACCESS_TOKEN
  if (!token) return null
  const url = new URL('https://api.themoviedb.org/3' + path)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  const key = url.href
  const cached = cache.get(key)
  const stale = (cached?.value as T | undefined) ?? null
  if (cached && cached.expires > Date.now()) return stale
  const shared = pending.get(key)
  if (shared) return await shared as T | null
  const load = (async () => {
    const backoff = [250, 600]
    for (let attempt = 0; Date.now() >= retryAfter; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {Authorization: `Bearer ${token}`, Accept: 'application/json'},
          signal: AbortSignal.timeout(3500),
        })
        if (response.status === 429) {
          const header = response.headers.get('retry-after')
          const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? (Date.parse(header) - Date.now()) / 1000 : NaN
          retryAfter = Date.now() + Math.min(Number.isFinite(seconds) ? Math.max(seconds, 1) : 60, 3600) * 1000
          return stale
        }
        if (detail && response.status === 404) {
          cache.delete(key)
          catalogueMovies.delete(Number(path.split('/').at(-1)))
          throw new HttpError(404, 'This movie could not be found.')
        }
        if (response.ok) {
          const value = await response.json() as T
          if (!cache.has(key) && cache.size >= 300) cache.delete(cache.keys().next().value!)
          cache.set(key, {value, expires: Date.now() + 15 * 60 * 1000})
          return value
        }
        if (response.status < 500 && response.status !== 408) return stale
      } catch (error) {
        if (error instanceof HttpError) throw error
      }
      if (attempt >= backoff.length) break
      await new Promise(resolve => setTimeout(resolve, backoff[attempt]))
    }
    return stale
  })()
  pending.set(key, load)
  try { return await load }
  finally { pending.delete(key) }
}

export async function movieList(kind: string, query: string, page: number, genre?: number) {
  if (kind === 'demo') kind = 'now-playing'
  if (!Object.hasOwn(lists, kind)) throw new HttpError(404, 'Movie list not found.')
  if (kind === 'search' && !query) return {results: [], source: 'tmdb', page: 1, total_pages: 1}
  const window = releaseWindow()
  const params: Record<string, string> = {language: 'en-IN', page: String(page)}
  const regional = kind === 'now-playing' || kind === 'upcoming'
  if (regional) {
    const upcoming = kind === 'upcoming'
    Object.assign(params, {
      region: 'IN', with_release_type: '3|2', include_adult: 'false',
      'primary_release_date.gte': window.earliest,
      'primary_release_date.lte': window.latest,
      'release_date.gte': upcoming ? window.tomorrow : window.earliest,
      'release_date.lte': upcoming ? window.latest : window.today,
      sort_by: upcoming ? 'primary_release_date.asc' : 'popularity.desc',
    })
  } else if (kind === 'search') {
    Object.assign(params, {query, include_adult: 'false'})
  }
  if (regional && genre) params.with_genres = String(genre)
  const response = await tmdb<{results: Movie[]; page: number; total_pages: number}>(regional ? '/discover/movie' : lists[kind], params)
  if (!response || !Array.isArray(response.results)) return {results: [], source: 'unavailable', page, total_pages: 1}

  const results = response.results.filter(movie => isReleaseInWindow(movie.release_date, window)
    && (kind !== 'now-playing' || movie.release_date <= window.today)
    && (kind !== 'upcoming' || movie.release_date > window.today)
    && (!genre || movie.genre_ids.includes(genre)))
    .map(movie => regional ? {...movie, india_release_date: movie.release_date} : movie)
  for (const movie of results) {
    const known = catalogueMovies.get(movie.id)
    catalogueMovies.delete(movie.id)
    if (catalogueMovies.size >= 500) catalogueMovies.delete(catalogueMovies.keys().next().value!)
    catalogueMovies.set(movie.id, {...movie, india_release_date: movie.india_release_date ?? known?.india_release_date})
  }
  return {...response, results, source: 'tmdb'}
}

export async function movieDetail(id: number, allowSummary = false) {
  const result = await tmdb<Movie & {release_dates?: ReleaseDates}>(`/movie/${id}`, {language: 'en-US', append_to_response: 'credits,videos,release_dates'}, true)
  const summary = catalogueMovies.get(id)
  if (result) {
    const {release_dates, ...movie} = result
    const indiaDate = indiaTheatricalDate(release_dates) ?? summary?.india_release_date
    return {...movie, india_release_date: indiaDate, genre_ids: movie.genres?.map(genre => genre.id) ?? [], source: 'tmdb'}
  }
  const sampleMovie = samples.find(movie => movie.id === id)
  if (sampleMovie) return {...sampleMovie, genres: genres.filter(genre => sampleMovie.genre_ids.includes(genre.id)), source: 'sample'}
  if (allowSummary && summary) return {...summary, source: 'catalogue'}
  throw new HttpError(503, 'Movie details are temporarily unavailable. Please try again shortly.')
}

export async function publicMovieDetail(id: number, allowSummary = true) {
  const movie = await movieDetail(id, allowSummary)
  if (!isReleaseInWindow(movie.release_date)) throw new HttpError(404, 'This title is outside the current release catalogue.')
  return movie
}

export async function movieGenres() {
  return (await tmdb<{genres: typeof genres}>('/genre/movie/list', {language: 'en'}))?.genres ?? genres
}
