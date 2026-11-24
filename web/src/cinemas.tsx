import { Link, useParams } from 'react-router-dom'
import { Empty, Failure, Loading, PageTitle, useApi, useApp, type Cinema, type Screen } from './core'
import { ShowtimePicker } from './movies'

export function CinemaDetails() {
  const {id} = useParams()
  const request = useApi<Cinema & {screens: Screen[]; city: {name: string}}>('/cinemas/' + id)
  const {city, setCity} = useApp()
  const venue = request.data
  return <main className="shell page">{request.loading ? <Loading/> : request.error ? <Failure error={request.error} retry={request.retry}/> : venue && <>
    <Link to="/movies" className="breadcrumb">Back to movies</Link>
    <PageTitle eyebrow="Demo venue" title={venue.name} subtitle={venue.address}/>
    <div className="filters">{venue.screens.map(screen => <span className="pill" key={screen.id}>{screen.name}</span>)}</div>
    {venue.citySlug === city.slug ? <ShowtimePicker cinema={venue.id}/> : <Empty title={'This cinema is in ' + venue.city.name}><button className="button primary" onClick={() => setCity(venue.citySlug)}>Switch to {venue.city.name}</button></Empty>}
  </>}</main>
}
