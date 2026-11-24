import { createRoot } from 'react-dom/client'
import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthForm, Profile } from './account'
import { BookingHistory, BookingSummary, Confirmation, SeatSelection, SnacksSelection, TicketDetails, VerifyTicket } from './checkout'
import { AppProvider, Credits, Footer, Header, Loading, PageTitle, RequireUser } from './core'
import { Catalogue, Home, MovieDetails } from './movies'
import './styles.css'

const CinemaDetails = lazy(() => import('./cinemas').then(module => ({default: module.CinemaDetails})))
const Admin = lazy(() => import('./admin').then(module => ({default: module.Admin})))

function App() {
  const location = useLocation()
  useEffect(() => { if (!location.hash) window.scrollTo(0, 0) }, [location.pathname, location.hash])
  return <AppProvider><a href="#content" className="skip-link">Skip to content</a><Header/>
    <div id="content" className="site-content"><Suspense fallback={<div className="shell page"><Loading/></div>}><Routes>
      <Route path="/" element={<main><Home/></main>}/>
      <Route path="/movies" element={<Catalogue key="movies"/>}/>
      <Route path="/movies/:id" element={<MovieDetails/>}/>
      <Route path="/credits" element={<Credits/>}/>
      <Route path="/upcoming" element={<Catalogue key="upcoming" upcoming/>}/>
      <Route path="/cinemas" element={<Navigate to="/movies" replace/>}/>
      <Route path="/cinemas/:id" element={<CinemaDetails/>}/>
      <Route path="/shows/:id/seats" element={<SeatSelection/>}/>
      <Route path="/shows/:id/snacks" element={<SnacksSelection/>}/>
      <Route path="/shows/:id/summary" element={<RequireUser><BookingSummary/></RequireUser>}/>
      <Route path="/bookings" element={<RequireUser><BookingHistory/></RequireUser>}/>
      <Route path="/bookings/:reference/confirmed" element={<RequireUser><Confirmation/></RequireUser>}/>
      <Route path="/tickets/:reference" element={<RequireUser><TicketDetails/></RequireUser>}/>
      <Route path="/verify/:token" element={<VerifyTicket/>}/>
      <Route path="/login" element={<AuthForm key="login"/>}/>
      <Route path="/signup" element={<AuthForm key="signup" signup/>}/>
      <Route path="/profile" element={<RequireUser><Profile/></RequireUser>}/>
      <Route path="/admin" element={<RequireUser admin><Admin/></RequireUser>}/>
      <Route path="*" element={<main className="shell page narrow"><PageTitle eyebrow="404" title="Page not found" subtitle="The page may have moved or the address may be incorrect."/><Link className="button primary" to="/">Back to home</Link></main>}/>
    </Routes></Suspense></div><Footer/></AppProvider>
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><App/></BrowserRouter>)
