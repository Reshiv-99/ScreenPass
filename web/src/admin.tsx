import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api, Empty, errorMessage, Failure, Loading, Modal, money, PageTitle, SectionTitle, showDate, showTime, useApi, useApp, type Booking, type Cinema, type Screen, type Seat, type Show, type User } from './core'

type ScreenAdmin = Screen & {seats: (Pick<Seat, 'id' | 'row' | 'number' | 'category' | 'enabled'>)[]}
type ShowAdmin = Show & {seats: {price: number; category: string}[]}
type ManagedMovie = {tmdbId: number; title: string; cinemas: {cinemaId: string}[]}
type AdminBooking = Pick<Booking, 'reference' | 'movieTitle' | 'startsAt' | 'total' | 'status'>
type Counts = Record<'bookings' | 'users' | 'cinemas' | 'movies' | 'shows', number>
type Editor = {kind: 'cinema'; value?: Cinema} | {kind: 'screen'; value?: ScreenAdmin} | {kind: 'show'; value?: ShowAdmin} | {kind: 'movie'} | {kind: 'seat'; value: ScreenAdmin['seats'][number]}
type PaymentRecord = {id: string; orderId: string | null; paymentId: string | null; status: string; amountPaise: number; expiresAt: string; booking: {reference: string} | null; show: {movie: {title: string}}}
const tabs = ['Overview', 'Cinemas', 'Screens', 'Movies', 'Shows', 'Bookings', 'Payments', 'Users']
const dateValue = (value?: string) => value ? new Date(Date.parse(value) + 330 * 60_000).toISOString().slice(0, 16) : ''

export function Admin() {
  const {cities, notify, user: viewer} = useApp()
  const [tab, setTab] = useState('Overview')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [deleting, setDeleting] = useState<{path: string; label: string} | null>(null)
  const [staffChange, setStaffChange] = useState<{user: User; role: 'ADMIN' | 'CUSTOMER'} | null>(null)
  const [userEmail, setUserEmail] = useState('')
  const [screenId, setScreenId] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const counts = useApi<Counts>(tab === 'Overview' ? '/admin/overview' : null)
  const venues = useApi<Cinema[]>('/cinemas')
  const screens = useApi<ScreenAdmin[]>(['Screens', 'Shows'].includes(tab) ? '/admin/screens' : null)
  const films = useApi<ManagedMovie[]>(['Movies', 'Shows'].includes(tab) ? '/admin/movies' : null)
  const shows = useApi<ShowAdmin[]>(tab === 'Overview' ? '/admin/shows?upcoming=1' : tab === 'Shows' ? '/admin/shows' : null)
  const records = useApi<AdminBooking[]>(['Bookings', 'Overview'].includes(tab) ? '/admin/bookings' : null)
  const users = useApi<User[]>(tab === 'Users' ? '/admin/users' + (userEmail ? '?email=' + encodeURIComponent(userEmail) : '') : null)
  const payments = useApi<PaymentRecord[]>(tab === 'Payments' ? '/admin/payments' : null)
  const current = [payments, counts, venues, screens, films, shows, records, users]
  const activeScreen = screens.data?.find(screen => screen.id === screenId)
  const upcoming = shows.data?.filter(show => Date.parse(show.startsAt) > Date.now()).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).slice(0, 4)

  function refresh() {current.forEach(request => request.retry())}
  function open(value: Editor) {setError(''); setEditor(value)}
  function remove(path: string, label: string) {setError(''); setDeleting({path, label})}
  async function commit(method: string, path: string, data?: object) {
    setPending(true)
    setError('')
    try {
      await api.request({method, url: '/admin' + path, data})
      setEditor(null)
      setDeleting(null)
      setStaffChange(null)
      refresh()
      notify(method === 'DELETE' ? 'Inventory deleted.' : 'Changes saved.')
    } catch (error) {setError(errorMessage(error))}
    finally {setPending(false)}
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor) return
    const fields = new FormData(event.currentTarget)
    const text = (key: string) => String(fields.get(key) ?? '')
    const num = (key: string) => Number(text(key))
    const name = text('name')
    if (editor.kind === 'cinema') {
      void commit(editor.value ? 'PATCH' : 'POST', '/cinemas' + (editor.value ? '/' + editor.value.id : ''), {name, address: text('address'), citySlug: text('citySlug'), lat: num('lat'), lng: num('lng')})
    } else if (editor.kind === 'screen') {
      void commit(editor.value ? 'PATCH' : 'POST', '/screens' + (editor.value ? '/' + editor.value.id : ''), {name, cinemaId: text('cinemaId'), rows: num('rows'), seatsPerRow: num('seatsPerRow'), premiumRows: num('premiumRows')})
    } else if (editor.kind === 'movie') {
      void commit('POST', '/movies', {movieId: num('movieId'), cinemaId: text('cinemaId')})
    } else if (editor.kind === 'seat') {
      void commit('PATCH', '/seats/' + editor.value.id, {category: text('category'), enabled: fields.has('enabled')})
    } else {
      void commit(editor.value ? 'PATCH' : 'POST', '/shows' + (editor.value ? '/' + editor.value.id : ''), {screenId: editor.value?.screen.id || text('screenId'), movieId: num('movieId'), startsAt: text('startsAt') + ':00+05:30', endsAt: text('endsAt') + ':00+05:30', standardPrice: num('standardPrice'), premiumPrice: num('premiumPrice'), reclinerPrice: num('reclinerPrice')})
    }
  }

  const venuesOptions = venues.data?.map(venue => <option key={venue.id} value={venue.id}>{venue.name}</option>)
  const showRow = (show: ShowAdmin, editable: boolean) => <div className="admin-row" key={show.id}><div><strong>{show.movie.title}</strong><p>{show.screen.cinema.name} · {show.screen.name} · {showDate(show.startsAt)} · {showTime(show.startsAt)}</p></div>{editable && <Actions onEdit={() => open({kind: 'show', value: show})} onDelete={() => remove('/shows/' + show.id, show.movie.title)}/>}</div>
  const bookingRow = (booking: AdminBooking) => <div className="admin-row" key={booking.reference}><div><strong>{booking.movieTitle}</strong><p>{booking.reference} · {showDate(booking.startsAt)} · {booking.status.toLowerCase()}</p></div><strong>{money(booking.total)}</strong></div>
  return <main className="shell page">
    <PageTitle eyebrow="Admin" title="Inventory dashboard" subtitle="Manage demo schedules, seating, and booking activity."/>
    <div className="tabs admin-tabs">{tabs.map(item => <button key={item} className={item === tab ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
    {current.some(request => request.loading) && <Loading/>}
    {current.find(request => request.error) && <Failure error={current.find(request => request.error)!.error!} retry={refresh}/>}
    {tab === 'Overview' && <><div className="stat-grid">{counts.data && Object.entries(counts.data).map(([label, value]) => <div key={label} className="panel stat"><span>{label === 'shows' ? 'Upcoming shows' : label === 'movies' ? 'Managed movies' : label}</span><strong>{value}</strong></div>)}</div><div className="profile-grid">
      <section className="panel account-panel"><SectionTitle title="Upcoming shows"/>{upcoming?.map(show => showRow(show, false))}{upcoming?.length === 0 && <Empty title="No upcoming shows"/>}</section>
      <section className="panel account-panel"><SectionTitle title="Recent bookings"/>{records.data?.slice(0, 5).map(bookingRow)}{records.data?.length === 0 && <Empty title="No bookings yet"/>}</section>
    </div></>}
    {tab === 'Cinemas' && <AdminList title="Cinemas" action={() => open({kind: 'cinema'})} label="Add cinema">{venues.data?.map(venue => <div className="admin-row" key={venue.id}><div><strong>{venue.name}</strong><p>{venue.address}</p></div><Actions onEdit={() => open({kind: 'cinema', value: venue})} onDelete={() => remove('/cinemas/' + venue.id, venue.name)}/></div>)}</AdminList>}
    {tab === 'Screens' && <AdminList title="Screens and seating" action={() => open({kind: 'screen'})} label="Add screen">{screens.data?.map(screen => <div className="admin-row" key={screen.id}><div><strong>{screen.name}</strong><p>{screen.cinema.name} · {screen.seats.length} seats</p></div><div className="actions"><button className="button secondary" onClick={() => setScreenId(screenId === screen.id ? '' : screen.id)}>{screenId === screen.id ? 'Hide seats' : 'Manage seats'}</button><Actions onEdit={() => open({kind: 'screen', value: screen})} onDelete={() => remove('/screens/' + screen.id, screen.name)}/></div></div>)}
      {activeScreen && <div className="admin-seats"><h3>{activeScreen.cinema.name} · {activeScreen.name}</h3><p>Changes apply when generating show inventory.</p><div className="filters">{activeScreen.seats.map(seat => <button className={'pill ' + (seat.enabled ? seat.category.toLowerCase() : 'unavailable')} key={seat.id} onClick={() => open({kind: 'seat', value: seat})}>{seat.row + seat.number}</button>)}</div></div>}
    </AdminList>}
    {tab === 'Movies' && <AdminList title="Managed movies" action={() => open({kind: 'movie'})} label="Link TMDB movie">{films.data?.map(film => <div className="admin-row" key={film.tmdbId}><strong>{film.title}</strong><p>TMDB {film.tmdbId} · {film.cinemas.length} venues</p></div>)}</AdminList>}
    {tab === 'Shows' && <AdminList title="Showtimes" action={() => open({kind: 'show'})} label="Add show">{shows.data?.map(show => showRow(show, true))}</AdminList>}
    {tab === 'Bookings' && <AdminList title="Bookings">{records.data?.map(bookingRow)}</AdminList>}
    {tab === 'Payments' && <AdminList title="Razorpay test payments">
      {payments.data?.length === 0 && <Empty title="No test payments yet"/>}
      {payments.data?.map(payment => <div className="admin-row" key={payment.id}>
        <div><strong>{payment.show.movie.title}</strong><p>{payment.booking?.reference ?? payment.paymentId ?? payment.orderId ?? 'Order being prepared'}</p></div>
        <div><strong>{money(payment.amountPaise / 100)}</strong><p>{payment.status === 'REVIEW' ? 'Review needed' : payment.status === 'HOLD' ? Date.parse(payment.expiresAt) > Date.now() ? 'Seats held' : 'Hold expired' : payment.status === 'CONFIRMED' ? 'Test payment verified' : 'Order failed'}</p></div>
      </div>)}
    </AdminList>}
    {tab === 'Users' && <AdminList title="Users">
      {viewer?.role === 'OWNER' && <p className="inline-note">Staff can sign up with their own email. Find their account below to grant or revoke admin access.</p>}
      <form className="form staff-search" onSubmit={event => {
        event.preventDefault()
        setUserEmail(String(new FormData(event.currentTarget).get('email') || '').trim())
      }}>
        <label>Account email<input name="email" type="email" placeholder="Search by exact email" maxLength={254}/></label>
        <button className="button secondary">Find account</button>
        {userEmail && <button type="button" className="button quiet" onClick={event => {event.currentTarget.form?.reset(); setUserEmail('')}}>Clear search</button>}
      </form>
      {users.data?.length === 0 && <Empty title="No accounts found"/>}
      {users.data?.map(user => <div className="admin-row" key={user.id}>
        <div><strong>{user.name}</strong><p>{user.email}</p></div>
        <div className="actions">
          <span className="pill">{user.role === 'OWNER' ? 'Owner' : user.role === 'ADMIN' ? 'Admin' : 'Customer'}</span>
          {viewer?.role === 'OWNER' && user.role !== 'OWNER' && <button className="button secondary" onClick={() => {
            setError('')
            setStaffChange({user, role: user.role === 'ADMIN' ? 'CUSTOMER' : 'ADMIN'})
          }}>{user.role === 'ADMIN' ? 'Revoke admin access' : 'Grant admin access'}</button>}
        </div>
      </div>)}
    </AdminList>}
    {staffChange && <Modal title={staffChange.role === 'ADMIN' ? 'Grant admin access?' : 'Revoke admin access?'} onClose={() => {if (!pending) setStaffChange(null)}}>
      <p>{staffChange.role === 'ADMIN'
        ? `${staffChange.user.email} will be able to manage cinema inventory and view bookings and users. Confirm that the staff member controls this account before granting access.`
        : `${staffChange.user.email} will return to customer access and keep their own bookings.`}</p>
      {error && <Failure error={error}/>}
      <div className="actions">
        <button className="button secondary" disabled={pending} onClick={() => setStaffChange(null)}>Cancel</button>
        <button className="button primary" disabled={pending} onClick={() => commit('PATCH', '/users/' + staffChange.user.id + '/role', {role: staffChange.role})}>{pending ? 'Saving…' : 'Confirm'}</button>
      </div>
    </Modal>}
    {editor && <Modal title={editor.kind === 'movie' ? 'Link a TMDB movie' : ('value' in editor && editor.value ? 'Edit ' : 'Add ') + editor.kind} onClose={() => {if (!pending) setEditor(null)}}>
      <form className="form" onSubmit={save}>
        {editor.kind === 'cinema' && <><label>Name<input name="name" defaultValue={editor.value?.name} required maxLength={120}/></label><label>Address<input name="address" defaultValue={editor.value?.address} required maxLength={120}/></label>
          <label>City<select name="citySlug" defaultValue={editor.value?.citySlug}>{cities.map(city => <option key={city.slug} value={city.slug}>{city.name}</option>)}</select></label>
          <div className="form-pair"><label>Latitude<input type="number" name="lat" step="any" min={-90} max={90} defaultValue={editor.value?.lat} required/></label><label>Longitude<input type="number" name="lng" step="any" min={-180} max={180} defaultValue={editor.value?.lng} required/></label></div>
        </>}
        {editor.kind === 'screen' && <><label>Screen name<input name="name" defaultValue={editor.value?.name} required maxLength={120}/></label>{!editor.value && <>
          <label>Cinema<select name="cinemaId" required><option value="">Choose a cinema</option>{venuesOptions}</select></label>
          <div className="form-pair"><label>Rows<input name="rows" type="number" min={1} max={26} defaultValue={7} required/></label><label>Seats per row<input name="seatsPerRow" type="number" min={1} max={30} defaultValue={12} required/></label></div>
          <label>Premium rows at back<input name="premiumRows" type="number" min={0} max={26} defaultValue={2} required/></label></>}
        </>}
        {editor.kind === 'movie' && <><label>TMDB movie ID<input name="movieId" type="number" min={1} required/></label><label>Cinema<select name="cinemaId" required><option value="">Choose a cinema</option>{venuesOptions}</select></label></>}
        {editor.kind === 'seat' && <><p>Seat {editor.value.row + editor.value.number}</p><label>Category<select name="category" defaultValue={editor.value.category}><option value="STANDARD">Classic</option><option value="PREMIUM">Prime</option><option value="RECLINER">Recliner</option></select></label><label className="checkbox"><input type="checkbox" name="enabled" defaultChecked={editor.value.enabled}/> Available for new show inventory</label></>}
        {editor.kind === 'show' && <>
          <label>Screen<select name="screenId" disabled={!!editor.value} defaultValue={editor.value?.screen.id || ''} required><option value="">Choose a screen</option>{screens.data?.map(screen => <option key={screen.id} value={screen.id}>{screen.cinema.name} · {screen.name}</option>)}</select></label>
          <label>Movie<select name="movieId" defaultValue={editor.value?.movieId || ''} required><option value="">Choose a managed movie</option>{films.data?.map(film => <option key={film.tmdbId} value={film.tmdbId}>{film.title}</option>)}</select></label>
          <div className="form-pair"><label>Starts (IST)<input type="datetime-local" name="startsAt" defaultValue={dateValue(editor.value?.startsAt)} required/></label><label>Ends (IST)<input type="datetime-local" name="endsAt" defaultValue={dateValue(editor.value?.endsAt)} required/></label></div>
          <div className="form-pair"><label>Classic price (₹)<input name="standardPrice" type="number" min={0} defaultValue={editor.value?.seats.find(seat => seat.category === 'STANDARD')?.price ?? 350} required/></label><label>Prime price (₹)<input name="premiumPrice" type="number" min={0} defaultValue={editor.value?.seats.find(seat => seat.category === 'PREMIUM')?.price ?? 550} required/></label><label>Recliner price (₹)<input name="reclinerPrice" type="number" min={0} defaultValue={editor.value?.seats.find(seat => seat.category === 'RECLINER')?.price ?? 750} required/></label></div>
        </>}
        {error && <Failure error={error}/>}<button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</button>
      </form>
    </Modal>}
    {deleting && <Modal title="Delete inventory?" onClose={() => {if (!pending) setDeleting(null)}}><p>Delete {deleting.label}? Existing bookings and dependent inventory can prevent deletion.</p>{error && <Failure error={error}/>}<div className="actions"><button className="button secondary" onClick={() => setDeleting(null)} disabled={pending}>Keep inventory</button><button className="button primary" onClick={() => commit('DELETE', deleting.path)} disabled={pending}>Delete inventory</button></div></Modal>}
  </main>
}

function Actions({onEdit, onDelete}: {onEdit: () => void; onDelete: () => void}) {
  return <div className="actions"><button className="icon-button" aria-label="Edit inventory" onClick={onEdit}><Pencil size={17}/></button><button className="icon-button" aria-label="Delete inventory" onClick={onDelete}><Trash2 size={17}/></button></div>
}
function AdminList({title, action, label, children}: {title: string; action?: () => void; label?: string; children: React.ReactNode}) {
  return <section className="panel account-panel"><div className="section-title"><h2>{title}</h2>{action && <button className="button primary" onClick={action}><Plus size={17}/>{label}</button>}</div>{children}</section>
}
