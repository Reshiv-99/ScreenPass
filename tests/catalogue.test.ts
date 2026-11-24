import { afterEach, expect, test, vi } from 'vitest'
import { movieDetail, movieList, publicMovieDetail } from '../server/src/catalogue'

import { releaseWindow } from '../server/src/releases'
import { demoShowtimes } from '../web/src/demo-showtimes'

const movie = (id: number) => ({id, title: 'Test movie', poster_path: null, backdrop_path: null, overview: 'A synopsis.', release_date: releaseWindow().today, vote_average: 7, genre_ids: []})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

test('retries a connection reset and returns the full movie details', async () => {
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  const film = {...movie(900001), runtime: 95}
  const upstream = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(Response.json(film))
  await expect(movieDetail(film.id, true)).resolves.toMatchObject({runtime: 95, source: 'tmdb'})
  expect(upstream).toHaveBeenCalledTimes(2)
})

test('shows the catalogue summary when the full details remain unavailable', async () => {
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  const film = movie(900002)
  const upstream = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({results: [film], page: 31, total_pages: 31}))
    .mockImplementation(async () => new Response(null, {status: 503}))
  await movieList('now-playing', '', 31)
  await expect(movieDetail(film.id, true)).resolves.toMatchObject({...film, india_release_date: film.release_date, source: 'catalogue'})
  await expect(movieDetail(film.id)).rejects.toMatchObject({status: 503})
  expect(upstream).toHaveBeenCalledTimes(7)
})

test('reports a confirmed missing movie without retrying', async () => {
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, {status: 404}))
  await expect(movieDetail(900003, true)).rejects.toMatchObject({status: 404})
  expect(upstream).toHaveBeenCalledTimes(1)
})

test('filters old releases from search and public movie pages', async () => {
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  const current = movie(900004)
  const old = {...movie(900005), release_date: '2008-07-18'}
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({results: [old, current], page: 1, total_pages: 1}))
    .mockResolvedValueOnce(Response.json(old))
  const result = await movieList('search', 'filter test', 1)
  expect(result.results.map(item => item.id)).toEqual([current.id])
  await expect(publicMovieDetail(old.id)).rejects.toMatchObject({status: 404})
})

test('uses the first India theatrical date and ignores digital releases and later screenings', async () => {
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  const film = movie(900006)
  const {today, tomorrow} = releaseWindow()
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({...film, release_dates: {results: [
    {iso_3166_1: 'US', release_dates: [{type: 3, release_date: '2025-11-01T00:00:00Z'}]},
    {iso_3166_1: 'IN', release_dates: [
      {type: 3, release_date: tomorrow + 'T00:00:00Z'},
      {type: 4, release_date: '2025-12-01T00:00:00Z'},
      {type: 2, release_date: today + 'T00:00:00Z'},
    ]},
  ]}}))
  await expect(publicMovieDetail(film.id)).resolves.toMatchObject({india_release_date: today})
})

test('rolls demo timings in IST and excludes times that have passed', () => {
  const times = demoShowtimes(new Date('2026-11-12T10:00:00Z'))
  expect(times[0]).toBe('2026-11-12T13:30:00.000Z')
  expect(times[1]).toBe('2026-11-13T06:00:00.000Z')
  expect(times).toHaveLength(10)
})


test('retries a cold catalogue page and shares the upstream work for duplicate requests', async () => {
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  const film = movie(900007)
  const upstream = vi.spyOn(globalThis, 'fetch')
    .mockRejectedValueOnce(new TypeError('connection reset'))
    .mockResolvedValueOnce(new Response(null, {status: 502}))
    .mockResolvedValueOnce(Response.json({results: [film], page: 2, total_pages: 6}))
  const results = await Promise.all([movieList('now-playing', '', 2), movieList('now-playing', '', 2)])
  expect(results[0]).toEqual(results[1])
  expect(results[0]).toMatchObject({source: 'tmdb', page: 2, results: [{id: film.id}]})
  expect(upstream).toHaveBeenCalledTimes(3)
})
