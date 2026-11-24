import type { SnackItem } from '../../shared/snacks'
import axios from 'axios'
import { Armchair, ArrowRight, ChevronDown, Film, LocateFixed, MapPin, Menu, Search, Ticket, UserRound, X } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { Movie } from '../../server/src/catalogue'
import { CitySearch } from './city-search'
import { chooseCity, lookupCity, readCityPreference, type City } from './location'

export type { Movie }
export type { City }
export type User = {id: string; name: string; email: string; role: 'CUSTOMER' | 'ADMIN' | 'OWNER'}
export type Cinema = {id: string; name: string; address: string; lat: number; lng: number; citySlug: string}
export type Screen = {id: string; name: string; cinemaId: string; cinema: Cinema}
export type Show = {id: string; movieId: number; startsAt: string; endsAt: string; screen: Screen; movie: {title: string; poster: string | null}}
export type Seat = {id: string; row: string; number: number; price: number; category: 'STANDARD' | 'PREMIUM' | 'RECLINER'; enabled: boolean; booked: boolean; held?: boolean}
export type Booking = {reference: string; movieTitle: string; poster: string | null; cinemaName: string; screenName: string; startsAt: string; total: number; status: 'CONFIRMED' | 'CANCELLED'; canCancel: boolean; snacks?: SnackItem[] | null; email?: {status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED'} | null; payment?: {status: string; paymentId: string | null} | null; seats: {label: string; category: string; price: number}[]; qr?: string}
export type Subscription = {tmdbId: number; title: string; releaseDate: string | null; released: boolean}

export const api = axios.create({baseURL: '/api', withCredentials: true, timeout: 13000})
export const errorMessage = (error: unknown) => axios.isAxiosError(error) ? error.response?.data?.error || 'Could not connect. Please try again.' : 'Something went wrong.'
export const money = (value: number) => new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR', maximumFractionDigits: 0}).format(value)
export const showDate = (value: string) => new Intl.DateTimeFormat('en-IN', {timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short'}).format(new Date(value))
export const showTime = (value: string) => new Intl.DateTimeFormat('en-IN', {timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit'}).format(new Date(value))
export const screenLabel = (name: string) => /^Demo Auditorium \d+$/.test(name) ? 'Demo auditorium' : name
export const posterUrl = (path: string, size = 'w500') => 'https://image.tmdb.org/t/p/' + size + path
const localArtwork = new Set([
  '1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
  '4HodYYKEIsGOdinkGi2Ucz6X9i0.jpg',
  '8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg',
  '8tZYtuWezp8JbcsvHYO0O46tFbo.jpg',
  'dune-hero.jpg',
  'fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg',
  'gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
  'nlCHUWjY9XWbuEUQauCBgnY8ymF.jpg',
  'oppenheimer.jpg',
  'oppenheimer.jpg',
  'qJ2tW6WMUDux911r6m7haRef0WH.jpg',
  'xJHokMbljvjADYdit5fK5VQsXEG.jpg',
])
const sampleArtwork: Record<string, string> = {
  '/xOMo8BRK7PfcJvZ2G3fYWOhgX0e.jpg': 'dune-hero.jpg',
  '/ptpr0kzX2w9EMVH4qWemFLx3LyQ.jpg': 'oppenheimer.jpg',
}
export function imageUrl(path: string, size?: string) {
  const filename = sampleArtwork[path] ?? path.slice(1)
  return localArtwork.has(filename) || Object.hasOwn(sampleArtwork, path) ? '/posters/' + filename : posterUrl(path, size)
}

async function readApi<T>(url: string, signal: AbortSignal) {
  try {
    return await api.get<T>(url, {signal})
  } catch (error) {
    if (signal.aborted || !axios.isAxiosError(error)
      || (error.response && ![502, 504].includes(error.response.status))) throw error
    await new Promise(resolve => setTimeout(resolve, 300))
    return await api.get<T>(url, {signal})
  }
}

export function useApi<T>(url: string | null) {
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{url: string | null; version: number; data?: T; error?: string}>({url: null, version: -1})
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    readApi<T>(url, controller.signal).then(({data}) => setResult({url, version, data})).catch(error => {
      if (!controller.signal.aborted) setResult({url, version, error: errorMessage(error)})
    })
    return () => controller.abort()
  }, [url, version])
  const current = result.url === url && result.version === version ? result : undefined
  return {data: current?.data, error: current?.error, loading: !!url && !current, retry: () => setVersion(value => value + 1)}
}

type AppState = {cities: City[]; city: City; setCity: (city: string | City) => void; user: User | null; authReady: boolean; setUser: (user: User | null) => void; notify: (message: string, kind?: 'error' | 'success') => void}
const Context = createContext<AppState | null>(null)
export const useApp = () => useContext(Context)!
const defaultCity = {slug: 'delhi', name: 'Delhi'}

export function AppProvider({children}: {children: ReactNode}) {
  const cityList = useApi<City[]>('/cities')
  const [cityPreference, setCityPreference] = useState(readCityPreference)
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [toast, setToast] = useState<{message: string; kind: string} | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    readApi<User | null>('/auth/me', controller.signal)
      .then(({data}) => { if (!controller.signal.aborted) setUser(data) })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setAuthReady(true) })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])
  const cities = cityList.data ?? [defaultCity]
  const city = typeof cityPreference === 'string'
    ? cities.find(city => city.slug === cityPreference) ?? defaultCity
    : cities.find(city => city.slug === cityPreference.slug) ?? cityPreference
  return <Context.Provider value={{cities, city, user, authReady, setUser,
    setCity: value => {
      localStorage.setItem('cinevault.city', typeof value === 'string' ? value : JSON.stringify(value))
      setCityPreference(value)
    },
    notify: (message, kind = 'success') => setToast({message, kind}),
  }}>{children}{toast && <div className={'toast ' + toast.kind} role={toast.kind === 'error' ? 'alert' : 'status'}>{toast.message}<button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={16}/></button></div>}</Context.Provider>
}

export function Modal({title, onClose, children}: {title: string; onClose: () => void; children: ReactNode}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  return <dialog ref={dialog} aria-labelledby="dialog-title" onCancel={event => {event.preventDefault(); onClose()}} onClick={event => {if (event.target === event.currentTarget) onClose()}}>
    <div className="dialog-content"><div className="dialog-head"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</div>
  </dialog>
}

function Brand() {
  return <Link className="brand" to="/" aria-label="ScreenPass home">
    <span className="brand-mark"><Ticket size={20} strokeWidth={2} aria-hidden="true"/></span>
    <span>Screen<span>Pass</span></span>
  </Link>
}

export function Header() {
  const {city, cities, setCity, user, notify} = useApp()
  const [cityOpen, setCityOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  const [locationError, setLocationError] = useState('')
  const locationRequest = useRef<AbortController | null>(null)
  useEffect(() => () => locationRequest.current?.abort(), [])
  function closeCity() {
    locationRequest.current?.abort()
    locationRequest.current = null
    setLocating(false)
    setLocationError('')
    setCityOpen(false)
  }
  function selectCity(name: string, placeId?: string) {
    const chosen = chooseCity(name, cities)
    const custom = chosen.slug.startsWith('custom-')
    setCity(custom ? {...chosen, slug: placeId ? 'custom-' + placeId : chosen.slug} : chosen.slug)
    closeCity()
    notify('City set to ' + chosen.name + '.')
  }
  async function locate() {
    if (!navigator.geolocation) {
      setLocationError('Location detection is unavailable. Enter your city below.')
      return
    }
    const controller = new AbortController()
    locationRequest.current = controller
    setLocationError('')
    setLocating(true)
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {timeout: 9000})
      })
      if (controller.signal.aborted) return
      const name = await lookupCity(position.coords, controller.signal)
      if (!controller.signal.aborted) selectCity(name)
    } catch (error) {
      if (!controller.signal.aborted) {
        const denied = typeof error === 'object' && error !== null && 'code' in error && error.code === 1
        setLocationError(denied ? 'Location permission was blocked. Allow it in your browser or enter your city below.' : 'We couldn’t detect your city. Enter it below.')
      }
    } finally {
      if (locationRequest.current === controller) {
        locationRequest.current = null
        setLocating(false)
      }
    }
  }
  const links = [['/', 'Home'], ['/movies', 'Movies'], ['/upcoming', 'Upcoming']]
  return <header className="site-header"><div className="shell header-inner">
    <Brand/>
    <nav className={menuOpen ? 'nav open' : 'nav'} aria-label="Main navigation">{links.map(([url, label]) => <NavLink key={url} end={url === '/'} to={url}>{label}</NavLink>)}{user && <NavLink className="nav-bookings" to="/bookings"><Ticket size={16} aria-hidden="true"/>My bookings</NavLink>}</nav>
    <div className="header-actions">
      <button className="location-button" onClick={() => setCityOpen(true)}><MapPin size={16}/><span>{city.name}</span><ChevronDown size={13}/></button>
      <button className="icon-button search-button" onClick={() => navigate('/movies?focus=1')} aria-label="Search movies"><Search size={19}/></button>
      {user ? <Link className="button secondary account" aria-label="Your profile" to="/profile"><UserRound size={16}/><span>{user.name.split(' ')[0]}</span></Link> : <Link className="button primary header-signin" aria-label="Sign in" to="/login"><UserRound size={15}/> <span>Sign in</span></Link>}
      <button className="icon-button mobile-toggle" aria-label="Toggle navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X/> : <Menu/>}</button>
    </div>
    {cityOpen && <Modal title="Choose your city" onClose={closeCity}>
      <button className="button secondary locate" onClick={locate} disabled={locating}><LocateFixed size={17}/>{locating ? 'Finding your location…' : 'Use my location'}</button>
      <p className="location-privacy">BigDataCloud uses your approximate location to look up your city.</p>
      {locationError && <p className="location-error" role="alert">{locationError}</p>}
      <CitySearch onSelect={selectCity}/>
      <div className="city-grid">{cities.map(item => <button key={item.slug} className={item.slug === city.slug ? 'pill active' : 'pill'} onClick={() => {setCity(item.slug); closeCity()}}>{item.name}</button>)}</div>
    </Modal>}
  </div></header>
}

export function Footer() {
  const [helpOpen, setHelpOpen] = useState(false)
  return <footer className="site-footer">
    <div className="shell">
      <div className="footer-inner">
        <div className="footer-brand">
          <Brand/>
          <p>Discover new releases, explore showtimes, and book demo cinema tickets in your city.</p>
        </div>
        <nav className="footer-column" aria-label="Explore">
          <h2>Explore</h2>
          <Link to="/">Home</Link>
          <Link to="/movies">Movies</Link>
          <Link to="/upcoming">Upcoming</Link>
        </nav>
        <nav className="footer-column" aria-label="Browse genres">
          <h2>Genres</h2>
          <Link to="/movies?genre=28">Action</Link>
          <Link to="/movies?genre=878">Sci-fi</Link>
          <Link to="/movies?genre=18">Drama</Link>
          <Link to="/movies?genre=53">Thriller</Link>
        </nav>
        <nav className="footer-column" aria-label="Account and support">
          <h2>Account & support</h2>
          <Link to="/bookings">My bookings</Link>
          <Link to="/profile">My profile</Link>
          <button type="button" onClick={() => setHelpOpen(true)}>Booking help</button>
        </nav>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} ScreenPass</span>
        <Link to="/credits">Credits</Link>
      </div>
    </div>
    {helpOpen && <Modal title="Booking help" onClose={() => setHelpOpen(false)}>
      <dl className="footer-help">
        <div><dt>How do I book a ticket?</dt><dd>Pick a movie, choose a demo showtime in your city, and select your seats. Sign in to complete checkout.</dd></div>
        <div><dt>Will I be charged?</dt><dd>ScreenPass checkout is a simulation. No real money is charged.</dd></div>
        <div><dt>How do I find or cancel a ticket?</dt><dd>Open My bookings to view your QR ticket or cancel a booking more than 30 minutes before showtime.</dd></div>
      </dl>
      <Link className="button secondary" to="/bookings" onClick={() => setHelpOpen(false)}>Open my bookings</Link>
    </Modal>}
  </footer>
}

export function Credits() {
  return <main className="shell page narrow">
    <PageTitle title="Credits"/>
    <section className="panel account-panel credits-panel" aria-label="Movie data and artwork">
      <a href="https://www.themoviedb.org"><img src="/credits/tmdb.svg" alt="TMDB" width="64" height="46"/></a>
      <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      <a className="text-link" href="https://commons.wikimedia.org/wiki/File:Tmdb.new.logo.svg">Logo by Travis Bell · CC BY-SA 4.0</a>
    </section>
  </main>
}

export function Poster({path, title, className = ''}: {path?: string | null; title: string; className?: string}) {
  const [failed, setFailed] = useState<string | null>(null)
  return <div className={'poster ' + className}>
    {path && failed !== path ? <img src={imageUrl(path)} alt={title + ' poster'} loading="lazy" onError={() => setFailed(path)}/> : <div className="poster-placeholder"><Film size={28}/><span>{title}</span></div>}
  </div>
}
export function Loading({label = 'Loading…'}: {label?: string}) {
  return <div role="status" className="loading"><span className="skeleton-line"/><span>{label}</span></div>
}
export function Empty({title, message, children}: {title: string; message?: string; children?: ReactNode}) {
  return <div className="empty"><Armchair size={25}/><h3>{title}</h3>{message && <p>{message}</p>}{children}</div>
}
export function Failure({error, retry}: {error: string; retry?: () => void}) {
  return <div className="failure" role="alert"><p>{error}</p>{retry && <button className="button secondary" onClick={retry}>Try again</button>}</div>
}
export function PageTitle({eyebrow, title, subtitle}: {eyebrow?: string; title: string; subtitle?: string}) {
  return <div className="page-title">{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
}
export function SectionTitle({title, subtitle, to, action}: {title: string; subtitle?: string; to?: string; action?: string}) {
  return <div className="section-title"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{to && <Link className="text-link" to={to}>{action || 'View all'} <ArrowRight size={16}/></Link>}</div>
}
export function RequireUser({children, admin}: {children: ReactNode; admin?: boolean}) {
  const {user, authReady} = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (authReady && !user) navigate('/login?next=' + encodeURIComponent(location.pathname + location.search), {replace: true})
  }, [authReady, user, navigate, location.pathname, location.search])
  if (!authReady || !user) return <div className="shell page"><Loading label="Checking your session…"/></div>
  if (admin && user.role === 'CUSTOMER') return <div className="shell page"><Empty title="Admin access required"><Link className="button secondary" to="/">Back to home</Link></Empty></div>
  return children
}
export const DemoNote = () => <p className="demo-note"><Ticket size={15}/> Demo booking · No payment will be collected</p>
