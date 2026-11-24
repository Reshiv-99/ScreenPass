import { ArrowRight, Bell, CalendarDays, ChevronLeft, ChevronRight, Clock3, Play, Search, Star, Ticket } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, Empty, errorMessage, Failure, imageUrl, Loading, Modal, PageTitle, Poster, SectionTitle, screenLabel, showDate, showTime, useApi, useApp, type Movie, type Show, type Subscription } from './core'

import { demoShowtimes } from './demo-showtimes'

type FilmList = {results: Movie[]; source: 'unavailable' | 'tmdb'; page: number; total_pages: number}
type Genre = {id: number; name: string}
const heroDetails = (film: Movie) => [film.release_date?.slice(0, 4), film.runtime ? `${Math.floor(film.runtime / 60)}h ${film.runtime % 60}m` : null].filter(Boolean).join('  ·  ')
const releaseDate = (date: string) => date ? new Intl.DateTimeFormat('en-IN', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'}).format(new Date(date)) : 'Date to be announced'

function Trailer({id, title, onClose}: {id: number; title: string; onClose: () => void}) {
  const request = useApi<NonNullable<Movie['videos']>>('/movies/' + id + '/videos')
  const clips = request.data?.results.filter(clip => clip.site === 'YouTube' && /^[\w-]{11}$/.test(clip.key))
  const video = clips?.find(clip => clip.type === 'Trailer') ?? clips?.[0]
  return <Modal title={title + ' trailer'} onClose={onClose}>
    {request.loading ? <Loading/> : request.error ? <Failure error={request.error} retry={request.retry}/> : video ? <iframe className="trailer" title={title + ' trailer'} src={'https://www.youtube-nocookie.com/embed/' + video.key} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen/> : <Empty title="Trailer unavailable"/>}
  </Modal>
}

export function MovieCard({film, upcoming = false}: {film: Movie; upcoming?: boolean}) {
  return <article className="movie-card">
    <Link className="movie-art" to={'/movies/' + film.id} aria-label={'View ' + film.title}>
      <Poster path={film.poster_path} title={film.title}/>
      {upcoming ? <span className="rating release"><CalendarDays size={13}/> {releaseDate(film.india_release_date ?? film.release_date)}</span> : film.vote_average > 0 && <span className="rating"><Star size={12} fill="currentColor"/> {film.vote_average.toFixed(1)}</span>}
    </Link>
    <Link className="film-name" to={'/movies/' + film.id}>{film.title}</Link>
    <div className="film-meta">{upcoming ? film.overview : heroDetails(film)}</div>
  </article>
}

const listUrl = (kind: string, page = 1, query = '', genre?: number) => `/movies/list/${kind}?page=${page}&q=${encodeURIComponent(query)}${genre ? '&genre=' + genre : ''}`

export function Home() {
  const playing = useApi<FilmList>(listUrl('now-playing'))
  const upcoming = useApi<FilmList>(listUrl('upcoming'))
  const [slide, setSlide] = useState(0)
  const [trailer, setTrailer] = useState<Movie | null>(null)
  const films = playing.data?.results ?? []
  const featured = films.slice(0, 4)
  const film = featured[slide % Math.max(featured.length, 1)]
  const backdrop = film?.backdrop_path ? imageUrl(film.backdrop_path, 'original') : null
  return <>
    <section className="hero" aria-label="Featured films">
      {backdrop && <div className="hero-image" key={backdrop} style={{backgroundImage: `url("${backdrop}")`}}/>}
      <div className="hero-shade"/>
      <div className="shell hero-inner">
        {film ? <div className="hero-content">
          <span className="hero-label"><span/> NOW PLAYING IN INDIA</span>
          <h1>{film.title}</h1>
          <div className="hero-meta">{film.vote_average > 0 && <span className="hero-score"><Star fill="currentColor" size={15}/> {film.vote_average.toFixed(1)}</span>}<span>{heroDetails(film)}</span></div>
          <p>{film.overview}</p>
          <div className="hero-buttons"><Link className="button primary" to={'/movies/' + film.id + '#showtimes'}><Ticket size={18}/> View demo showtimes <ArrowRight size={16}/></Link><button className="button glass" onClick={() => setTrailer(film)}><Play size={16} fill="currentColor"/> Watch trailer</button></div>
        </div> : <div className="hero-content"><h1>The big screen awaits.</h1>{playing.error ? <Failure error={playing.error} retry={playing.retry}/> : playing.loading ? <Loading label="Finding films…"/> : <Link className="button primary" to="/movies">Explore movies <ArrowRight size={17}/></Link>}</div>}
        {featured.length > 1 && <div className="hero-pagination" aria-label="Featured movie navigation">
          <div className="dots">{featured.map((item, index) => <button key={item.id} className={index === slide ? 'selected' : ''} aria-label={'Feature ' + item.title} aria-pressed={index === slide} onClick={() => setSlide(index)}/>)}</div>
          <div className="hero-arrows"><button className="icon-button" aria-label="Previous featured movie" onClick={() => setSlide((slide + featured.length - 1) % featured.length)}><ChevronLeft size={22}/></button><button className="icon-button" aria-label="Next featured movie" onClick={() => setSlide((slide + 1) % featured.length)}><ChevronRight size={22}/></button></div>
        </div>}
      </div>
    </section>
    <div className="shell home-sections">
      <section className="film-section"><SectionTitle title="Now playing" subtitle="Recent theatrical releases in India." to="/movies" action="Explore movies"/>
        {playing.loading && <PosterSkeleton/>}
        {playing.error && <Failure error={playing.error} retry={playing.retry}/>}
        {playing.data?.source === 'unavailable' && <Failure error="Current releases are temporarily unavailable." retry={playing.retry}/>}
        {!!films.length && <div className="film-grid">{films.slice(0, 6).map(item => <MovieCard key={item.id} film={item}/>)}</div>}
      </section>
      {!!upcoming.data?.results.length && <section className="film-section"><SectionTitle title="Coming soon" to="/upcoming" action="View upcoming"/><div className="film-grid">{upcoming.data.results.slice(0, 6).map(item => <MovieCard key={item.id} film={item} upcoming/>)}</div></section>}
    </div>
    {trailer && <Trailer id={trailer.id} title={trailer.title} onClose={() => setTrailer(null)}/>}
  </>
}

function PosterSkeleton() {
  return <div className="film-grid" role="status" aria-label="Loading movies">{Array.from({length: 6}, (_, index) => <div className="poster skeleton" key={index}/>)}</div>
}

export function Catalogue({upcoming = false}: {upcoming?: boolean}) {
  const [params, setParams] = useSearchParams()
  const initial = params.get('q') ?? ''
  const [query, setQuery] = useState(initial)
  const [term, setTerm] = useState(initial.trim())
  const selectedList = params.get('list')
  const mode = selectedList && ['trending', 'popular'].includes(selectedList) ? selectedList : 'now-playing'
  const requestedGenre = Number(params.get('genre'))
  const genre = Number.isSafeInteger(requestedGenre) && requestedGenre > 0 && requestedGenre <= 10000 ? requestedGenre : undefined
  const [page, setPage] = useState(1)
  useEffect(() => {
    const nextTerm = query.trim()
    if (nextTerm === term) return
    const timer = setTimeout(() => {setTerm(nextTerm); setPage(1)}, 250)
    return () => clearTimeout(timer)
  }, [query, term])
  const kind = upcoming ? 'upcoming' : term ? 'search' : mode
  const listKey = JSON.stringify([kind, term, genre])
  const [pageListKey, setPageListKey] = useState(listKey)
  const requestedPage = pageListKey === listKey ? page : 1
  const request = useApi<FilmList>(listUrl(kind, requestedPage, term, genre))
  const [lastPage, setLastPage] = useState<{key: string; data: FilmList}>()
  const currentPage = request.data?.source === 'tmdb' ? request.data : undefined
  useEffect(() => {
    if (currentPage) setLastPage({key: listKey, data: currentPage})
  }, [currentPage, listKey])
  const displayedPage = currentPage ?? (lastPage?.key === listKey ? lastPage.data : undefined)
  const failed = !!request.error || request.data?.source === 'unavailable'
  function changePage(next: number) {
    if (next === requestedPage) request.retry()
    else {setPageListKey(listKey); setPage(next)}
  }
  const genres = useApi<Genre[]>('/movies/genres')
  function setGenre(id?: number) {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      if (id) next.set('genre', String(id))
      else next.delete('genre')
      return next
    })
  }
  const filtered = displayedPage?.results.filter(film => (!upcoming || film.title.toLowerCase().includes(term.toLowerCase())) && (!genre || film.genre_ids.includes(genre)))
  return <main className="shell page">
    <PageTitle eyebrow={upcoming ? 'Coming soon' : 'The catalogue'} title={upcoming ? 'Upcoming movies' : 'Explore movies'} subtitle={upcoming ? 'See what’s coming to the big screen and follow releases in your profile.' : 'Find your next film, then check demo showtimes in your city.'}/>
    <div className="catalogue-tools">
      {!upcoming && <div className="tabs" aria-label="Movie lists">{[['now-playing', 'Now playing'], ['trending', 'Trending'], ['popular', 'Popular']].map(([id, label]) => <button key={id} className={mode === id ? 'active' : ''} onClick={() => {setParams(id === 'now-playing' ? {} : {list: id}); setQuery(''); setTerm(''); setPage(1)}}>{label}</button>)}</div>}
      <label className="search-field"><Search size={19}/><input autoFocus={params.has('focus')} aria-label="Search movies" type="search" placeholder="Search by movie title" maxLength={100} value={query} onChange={event => {setQuery(event.target.value); if (params.has('focus')) setParams(previous => {const next = new URLSearchParams(previous); next.delete('focus'); return next}, {replace: true})}}/></label>
    </div>
    {!!genres.data?.length && <div className="filters" aria-label="Filter this page by genre"><button className={!genre ? 'pill active' : 'pill'} onClick={() => setGenre()}>All genres</button>{genres.data.filter((item, index) => index < 9 || item.id === genre).map(item => <button key={item.id} className={genre === item.id ? 'pill active' : 'pill'} onClick={() => setGenre(item.id)}>{item.name}</button>)}</div>}
    {request.loading && (displayedPage ? <p className="inline-note" role="status">Loading page {requestedPage}…</p> : <PosterSkeleton/>)}
    {failed && <Failure error={displayedPage && displayedPage.page !== requestedPage
      ? `Page ${requestedPage} couldn’t load. Still showing page ${displayedPage.page}.`
      : request.error || 'Current releases are temporarily unavailable.'} retry={request.retry}/>}
    {displayedPage && filtered && (filtered.length ? <div className="film-grid">{filtered.map(film => <MovieCard key={film.id} film={film} upcoming={upcoming}/>)}</div> : <Empty title="No matching releases" message="Try a different title, genre, or page."/>)}
    {displayedPage && displayedPage.total_pages > 1 && <div className="pagination">
      <button className="button secondary" disabled={request.loading || displayedPage.page === 1} onClick={() => changePage(displayedPage.page - 1)}><ChevronLeft size={16}/> Previous</button>
      <span>Page {displayedPage.page}</span>
      <button className="button secondary" disabled={request.loading || displayedPage.page >= Math.min(displayedPage.total_pages, 500)} onClick={() => changePage(displayedPage.page + 1)}>Next <ChevronRight size={16}/></button>
    </div>}
  </main>
}

export function ShowtimePicker({movie, cinema, releasedInIndia = false}: {movie?: number; cinema?: string; releasedInIndia?: boolean}) {
  const {city} = useApp()
  const request = useApi<Show[]>('/shows?city=' + encodeURIComponent(city.slug) + (movie ? '&movie=' + movie : '') + (cinema ? '&cinema=' + cinema : ''))
  const [date, setDate] = useState('')
  const [opening, setOpening] = useState('')
  const [openError, setOpenError] = useState('')
  const navigate = useNavigate()
  const managed = request.data ?? []
  const existingTimes = new Set(managed.map(show => show.startsAt))
  const generated = releasedInIndia && !request.loading ? demoShowtimes().filter(start => !existingTimes.has(start)) : []
  async function openSeats(startsAt: string) {
    setOpening(startsAt)
    setOpenError('')
    try {
      const {data} = await api.post<{id: string}>('/shows/demo', {movieId: movie, city: city.slug, startsAt})
      navigate('/shows/' + data.id + '/seats')
    } catch (error) {
      setOpenError(errorMessage(error))
    } finally {setOpening('')}
  }
  const dates = [...new Set([...managed.map(show => show.startsAt), ...generated].sort().map(showDate))]
  const selected = dates.includes(date) ? date : dates[0]
  const shows = managed.filter(show => showDate(show.startsAt) === selected)
  const groups = new Map<string, Show[]>()
  for (const show of shows) {
    const label = movie ? show.screen.cinema.name : show.movie.title
    groups.set(label, [...(groups.get(label) ?? []), show])
  }
  const demoVenue = 'ScreenPass Demo Cinema · ' + city.name
  const generatedOnDate = generated.filter(start => showDate(start) === selected)
  if (generatedOnDate.length && !groups.has(demoVenue)) groups.set(demoVenue, [])
  return <section className="showtimes" id="showtimes"><SectionTitle title="Demo showtimes" subtitle={city.name + ' · All times in IST'}/>
    {request.loading && <Loading label="Finding showtimes…"/>}
    {openError && <Failure error={openError}/>}
    {request.error && !generated.length && <Failure error={request.error} retry={request.retry}/>}
    {request.data && !dates.length && <Empty title={'No demo showtimes in ' + city.name} message="A theatrical release in India is needed to generate demo timings."><Link className="button secondary" to="/movies">Browse current films</Link></Empty>}
    {!!dates.length && <div className="filters" aria-label="Show date">{dates.map(item => <button key={item} className={item === selected ? 'pill active' : 'pill'} onClick={() => setDate(item)}>{item}</button>)}</div>}
    {[...groups].map(([label, group]) => {
      const isDemoVenue = label === demoVenue
      const timings: {startsAt: string; show?: Show}[] = group.map(show => ({startsAt: show.startsAt, show}))
      if (isDemoVenue) timings.push(...generatedOnDate.map(startsAt => ({startsAt})))
      timings.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      return <div className="show-row panel" key={label}>
        <div><h3>{label}</h3><p>{isDemoVenue ? 'Simulated schedule · Demo tickets only' : movie ? group[0].screen.cinema.address : group[0].screen.cinema.name}</p></div>
        <div className="show-buttons">{timings.map(({startsAt, show}) => show
          ? <Link key={show.id} className="show-button" to={'/shows/' + show.id + '/seats'} aria-label={showTime(startsAt) + ', ' + screenLabel(show.screen.name)}><Clock3 size={14}/>{showTime(startsAt)}<small>{screenLabel(show.screen.name)}</small></Link>
          : <button key={startsAt} className="show-button" disabled={!!opening} onClick={() => openSeats(startsAt)}><Clock3 size={14}/>{showTime(startsAt)}<small>{opening === startsAt ? 'Opening seats…' : 'Choose seats'}</small></button>)}</div>
      </div>
    })}
  </section>
}

export function MovieDetails() {
  const {id} = useParams()
  const request = useApi<Movie & {source: string}>('/movies/' + id)
  const {user, notify} = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [trailer, setTrailer] = useState(false)
  const [pending, setPending] = useState(false)
  const subscription = useApi<Subscription[]>(user ? '/notifications' : null)
  const film = request.data
  const subscribed = subscription.data?.some(item => item.tmdbId === film?.id)
  const today = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Kolkata'}).format(new Date())
  const isUpcoming = !!film && (film.india_release_date ?? film.release_date) > today
  const releasedInIndia = !!film?.india_release_date && film.india_release_date <= today
  useEffect(() => {
    if (film && location.hash === '#showtimes') document.getElementById('showtimes')?.scrollIntoView({behavior: 'smooth'})
  }, [film, location.hash])
  async function toggle() {
    if (!user) {navigate('/login?next=' + encodeURIComponent(location.pathname)); return}
    setPending(true)
    try {
      if (subscribed) await api.delete('/notifications/' + id)
      else await api.post('/notifications/' + id)
      subscription.retry()
      notify(subscribed ? 'Reminder removed.' : 'Release reminder saved to your profile.')
    } catch (error) {notify(errorMessage(error), 'error')}
    finally {setPending(false)}
  }
  if (!film) return <main className="shell page">{request.loading ? <Loading/> : <Failure error={request.error || 'Movie unavailable.'} retry={request.retry}/>}</main>
  const backdrop = film.backdrop_path ? imageUrl(film.backdrop_path, 'w1280') : null
  return <main>
    <section className="detail-hero">{backdrop && <div className="detail-backdrop" style={{backgroundImage: `url("${backdrop}")`}}/>}
      <div className="shell detail-inner"><Poster path={film.poster_path} title={film.title}/><div>
        <div className="filters">{film.genres?.map(genre => <span className="pill" key={genre.id}>{genre.name}</span>)}</div>
        <h1>{film.title}</h1><div className="hero-meta">{film.vote_average > 0 && <span className="hero-score"><Star size={16} fill="currentColor"/> {film.vote_average.toFixed(1)}</span>}<span>{heroDetails(film)}</span>{isUpcoming && <span>{releaseDate(film.india_release_date ?? film.release_date)}</span>}</div>
        <p>{film.overview || 'A synopsis is unavailable.'}</p>
        <div className="hero-buttons">{isUpcoming ? <button className="button primary" onClick={toggle} disabled={pending || subscription.loading}><Bell size={17}/>{subscribed ? 'Remove reminder' : 'Notify me'}</button> : <a className="button primary" href="#showtimes"><Ticket size={17}/> Find showtimes</a>}<button className="button secondary" onClick={() => setTrailer(true)}><Play size={16}/> Watch trailer</button></div>
      </div></div>
    </section>
    <div className="shell page detail-body">
      {film.source === 'catalogue' && <p className="inline-note" role="status">Showing the movie summary while full movie details are temporarily unavailable.</p>}
      {isUpcoming
        ? <section id="showtimes"><Empty title="Demo showtimes open on release day" message={film.india_release_date ? 'India theatrical release · ' + releaseDate(film.india_release_date) : 'India theatrical release date is still to be announced.'}/></section>
        : <ShowtimePicker movie={film.id} releasedInIndia={releasedInIndia}/>}
      {!!film.credits?.cast.length && <section className="film-section"><SectionTitle title="Cast and crew"/><div className="credit-grid">{[...film.credits.crew.filter(person => person.job === 'Director').slice(0, 2).map(person => ({...person, character: person.job})), ...film.credits.cast.slice(0, 8)].map((person, index) => <div className="panel credit" key={person.id + '-' + index}><strong>{person.name}</strong><p>{person.character}</p></div>)}</div></section>}
    </div>
    {trailer && <Trailer id={film.id} title={film.title} onClose={() => setTrailer(false)}/>}
  </main>
}
