import { maxSnackQuantity, priceSnacks, snackChoices, snackPrice, snackSections, snackTotal, sizes, type SnackChoice, type SnackItem } from '../../shared/snacks'
import { Armchair, ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock3, MapPin, Minus, Plus, Printer, Ticket, X, Popcorn, CupSoda, Package } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, DemoNote, Empty, errorMessage, Failure, Loading, Modal, money, PageTitle, Poster, screenLabel, showDate, showTime, useApi, useApp, type Booking, type Seat, type Show } from './core'

import { loadCheckout } from './razorpay'

type PaymentMode = 'demo' | 'razorpay-test' | 'unavailable'
type PaymentResult = {status: 'confirmed'; reference: string} | {status: 'ready'; orderId: string; keyId: string; amount: number; expiresAt: string} | {status: 'review' | 'pending' | 'expired'}

type ShowWithSeats = Show & {seats: Seat[]}
type Draft = {seatIds: string[]; requestId: string; snacks: SnackChoice[]}
const draftKey = (id: string) => 'cinevault.draft.' + id
function readDraft(id: string): Draft | null {
  try {
    const draft: unknown = JSON.parse(sessionStorage.getItem(draftKey(id)) || 'null')
    if (!draft || typeof draft !== 'object' || !('seatIds' in draft) || !('requestId' in draft) || typeof draft.requestId !== 'string' || !Array.isArray(draft.seatIds) || !draft.seatIds.every(id => typeof id === 'string')) return null
    const savedSnacks = 'snacks' in draft && Array.isArray(draft.snacks) ? draft.snacks : []
    const activeSnacks = savedSnacks.filter(item => item?.id !== 'pretzel' && item?.id !== 'duo')
    const snacks = snackChoices.safeParse(activeSnacks)
    return {requestId: draft.requestId, seatIds: draft.seatIds, snacks: snacks.success ? snacks.data : []}
  } catch { return null }
}

function ShowInfo({show}: {show: Show}) {
  return <p className="show-info"><span><MapPin size={16}/> {show.screen.cinema.name} · {screenLabel(show.screen.name)}</span><span><CalendarDays size={16}/> {showDate(show.startsAt)}</span><span><Clock3 size={16}/> {showTime(show.startsAt)} IST</span></p>
}
const seatLabels: Record<Seat['category'], string> = {STANDARD: 'Classic', PREMIUM: 'Prime', RECLINER: 'Recliner'}
const seatLegend = {
  standard: seatLabels.STANDARD, premium: seatLabels.PREMIUM, recliner: seatLabels.RECLINER,
  selected: 'Selected', held: 'Held', booked: 'Booked', unavailable: 'Unavailable',
}

function Order({seats, snacks = [], action}: {seats: Seat[]; snacks?: SnackItem[]; action: React.ReactNode}) {
  const priceGroups = new Map<string, {price: number; count: number}>()
  for (const seat of seats) {
    const label = seatLabels[seat.category]
    const key = label + ' · ' + money(seat.price)
    const group = priceGroups.get(key)
    if (group) group.count++
    else priceGroups.set(key, {price: seat.price, count: 1})
  }
  return <aside className="panel order">
    <h2>Order summary</h2><p aria-live="polite">{seats.length ? `${seats.length} ${seats.length === 1 ? 'seat' : 'seats'} · ${seats.map(seat => seat.row + seat.number).join(', ')}` : 'Select seats to get started.'}</p>
    {[...priceGroups].map(([label, {price, count}]) => <div className="order-row" key={label}><span>{count} × {label} each</span><strong>{money(price * count)}</strong></div>)}
    {!!snacks.length && <div className="order-snacks"><h3>Snacks &amp; Drinks</h3>
      {snacks.map(item => <div className="order-row" key={item.id}><span>{item.quantity} × {item.name}</span><strong>{money(item.price * item.quantity)}</strong></div>)}
      <div className="order-row"><span>Snacks subtotal</span><strong>{money(snackTotal(snacks))}</strong></div>
    </div>}
    <div className="order-total"><span>Total</span><strong>{money(seats.reduce((total, seat) => total + seat.price, snackTotal(snacks)))}</strong></div>
    {action}<DemoNote/>
  </aside>
}

export function SeatSelection() {
  const {id = ''} = useParams()
  return <SeatSelectionForShow key={id} id={id}/>
}
function SeatSelectionForShow({id}: {id: string}) {
  const request = useApi<ShowWithSeats>('/shows/' + id + '/seats')
  const [selected, setSelected] = useState(() => readDraft(id)?.seatIds ?? [])
  const {notify} = useApp()
  const navigate = useNavigate()
  const show = request.data
  const seats = show?.seats.filter(seat => selected.includes(seat.id) && seat.enabled && !seat.booked && !seat.held) ?? []
  function toggle(seat: Seat) {
    const active = seats.map(seat => seat.id)
    if (active.includes(seat.id)) {setSelected(active.filter(id => id !== seat.id)); return}
    if (active.length === 10) {notify('Select up to 10 seats per booking.', 'error'); return}
    setSelected([...active, seat.id])
  }
  if (!show) return <main className="shell page">{request.loading ? <Loading/> : <Failure error={request.error || 'Show unavailable.'} retry={request.retry}/>}</main>
  const rows = new Map<string, Seat[]>()
  for (const seat of show.seats) {
    const row = rows.get(seat.row)
    if (row) row.push(seat)
    else rows.set(seat.row, [seat])
  }
  const sections: {label: string; rows: Seat[][]}[] = []
  for (const row of [...rows.values()].reverse()) {
    const rates = row.map(seat => `${seatLabels[seat.category]} ${money(seat.price)}`)
    const label = [...new Set(rates)].sort().join(' · ')
    const section = sections.at(-1)
    if (section?.label === label) section.rows.push(row)
    else sections.push({label, rows: [row]})
  }
  return <main className="shell page seat-page">
    <Link className="breadcrumb" to={'/movies/' + show.movieId + '#showtimes'}><ArrowLeft size={15}/> Back to showtimes</Link>
    <div className="seat-page-heading">
      <PageTitle title="Choose your seats"/>
      <nav className="checkout-steps" aria-label="Booking progress"><span aria-current="step">Seats</span><span>Snacks</span><span>Review</span><span>Ticket</span></nav>
    </div>
    <div className="panel seat-show"><Poster path={show.movie.poster} title={show.movie.title}/><div><h2 className="booking-movie">{show.movie.title}</h2><ShowInfo show={show}/></div><span className="pill">Demo show</span></div>
    <div className="seat-layout">
      <section className="panel seating" aria-label="Auditorium seat map">
        <div className="seating-heading"><div><h2>Auditorium</h2><p>Select up to 10 seats</p></div><span>{show.seats.filter(seat => seat.enabled && !seat.booked && !seat.held).length} available</span></div>
        <div className="seat-scroll" role="region" tabIndex={0} aria-label="Seat rows"><div className="seat-map">{sections.map(section => <div className="seat-section" key={section.rows[0][0].row}>
          <h3>{section.label}</h3>
          {section.rows.map(rowSeats => {
            const row = rowSeats[0].row
            return <div className="seat-row" key={row}>
              <span className="row-label" aria-hidden="true">{row}</span>
              {rowSeats.map((seat, index) => {
                const state = !seat.enabled ? 'unavailable' : seat.booked ? 'booked' : seat.held ? 'held' : selected.includes(seat.id) ? 'selected' : seat.category.toLowerCase()
                return <button className={'seat ' + state + (index === Math.ceil(rowSeats.length / 2) ? ' aisle' : '') + (seat.category === 'RECLINER' ? ' recliner-shape' : '')} disabled={seat.booked || seat.held || !seat.enabled} aria-pressed={state === 'selected'} aria-label={`Seat ${row}${seat.number}, ${state === seat.category.toLowerCase() ? seatLabels[seat.category].toLowerCase() : state}, ${money(seat.price)}`} key={seat.id} onClick={() => toggle(seat)}>{seat.booked ? <X size={13} aria-hidden="true"/> : seat.number}</button>
              })}
              <span className="row-label" aria-hidden="true">{row}</span>
            </div>
          })}
        </div>)}</div></div>
        <div className="screen-line" aria-hidden="true"/><div className="screen-text">Screen this way</div>
        <div className="legend">{Object.entries(seatLegend).map(([state, label]) => <span key={state}><i className={'seat ' + state} aria-hidden="true">{state === 'booked' && <X size={10}/>}</i>{label}</span>)}</div>
      </section>
      <Order seats={seats} action={<button className="button primary wide" disabled={!seats.length} onClick={() => {
        const seatIds = seats.map(seat => seat.id)
        const previous = readDraft(id)
        const requestId = previous && previous.seatIds.join() === seatIds.join() ? previous.requestId : crypto.randomUUID()
        sessionStorage.setItem(draftKey(id), JSON.stringify({seatIds, requestId, snacks: previous?.snacks ?? []}))
        navigate('/shows/' + id + '/snacks')
      }}>Continue <ArrowRight size={17}/></button>}/>
    </div>
  </main>
}

export function SnacksSelection() {
  const {id = ''} = useParams()
  return <SnacksForShow key={id} id={id}/>
}

function SnacksForShow({id}: {id: string}) {
  const draft = readDraft(id)
  const [choices, setChoices] = useState<SnackChoice[]>(() => draft?.snacks ?? [])
  const [section, setSection] = useState<keyof typeof snackSections>('Food')
  const [options, setOptions] = useState<Record<string, SnackChoice['id']>>({})
  const menuTabs = {Food: Popcorn, Drinks: CupSoda, Combos: Package}
  const sectionNames = Object.keys(menuTabs) as (keyof typeof menuTabs)[]
  const cart = priceSnacks(choices)
  const navigate = useNavigate()
  const show = useApi<ShowWithSeats>(draft ? '/shows/' + id + '/seats' : null)
  if (!draft?.seatIds.length) return <main className="shell page"><Empty title="Choose your seats first"><Link className="button primary" to={'/shows/' + id + '/seats'}>Choose seats</Link></Empty></main>

  function review(snacks: SnackChoice[]) {
    if (!draft) return
    const selection = JSON.stringify(priceSnacks(snacks))
    const requestId = selection === JSON.stringify(priceSnacks(draft.snacks)) ? draft.requestId : crypto.randomUUID()
    sessionStorage.setItem(draftKey(id), JSON.stringify({...draft, snacks, requestId}))
    navigate('/shows/' + id + '/summary')
  }

  function update(id: SnackChoice['id'], change: number) {
    setChoices(previous => {
      const quantity = (previous.find(item => item.id === id)?.quantity ?? 0) + change
      if (quantity < 0 || quantity > maxSnackQuantity) return previous
      return [...previous.filter(item => item.id !== id), ...(quantity ? [{id, quantity}] : [])]
    })
  }

  return <main className="shell page snacks-page">
    <Link className="breadcrumb" to={'/shows/' + id + '/seats'}><ArrowLeft size={15}/> Change seats</Link>
    <div className="seat-page-heading">
      <PageTitle title="Add snacks & drinks" subtitle={show.data ? show.data.movie.title + ' · ' + show.data.screen.cinema.name : undefined}/>
      <nav className="checkout-steps" aria-label="Booking progress"><span>Seats</span><span aria-current="step">Snacks</span><span>Review</span><span>Ticket</span></nav>
    </div>
    <div className="snack-layout">
      <div>
        <div className="snack-tabs" role="tablist" aria-label="Menu categories">
          {sectionNames.map((name, index) => {
            const Icon = menuTabs[name]
            return <button type="button" key={name} id={'snack-tab-' + name} role="tab" aria-selected={section === name} aria-controls="snack-menu" tabIndex={section === name ? 0 : -1} onClick={() => setSection(name)} onKeyDown={event => {
              const offsets: Record<string, number> = {ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: sectionNames.length - 1}
              if (!(event.key in offsets)) return
              event.preventDefault()
              const next = sectionNames[(offsets[event.key] + sectionNames.length) % sectionNames.length]
              setSection(next)
              document.getElementById('snack-tab-' + next)?.focus()
            }}><Icon size={17}/>{name}</button>
          })}
        </div>
        <section id="snack-menu" className="snack-grid" role="tabpanel" aria-labelledby={'snack-tab-' + section}>
          {snackSections[section].map(({name, description, image, options: variants}) => {
            const selected = options[image] ?? variants[0]
            const quantity = choices.find(item => item.id === selected)?.quantity ?? 0
            return <article className="panel snack-card" key={image}>
              <img src={'/snacks/' + image + '.jpg'} alt="" width={600} height={400}/>
              <div className="snack-card-body">
                <h2>{name}</h2><p>{description}</p>
                {variants.length > 1 && <div className="snack-sizes" role="group" aria-label={name + ' size'}>
                  {variants.map((variant, index) => <button key={variant} type="button" aria-pressed={selected === variant} onClick={() => setOptions(previous => ({...previous, [image]: variant}))}>{sizes[index]}</button>)}
                </div>}
                <div className="snack-card-controls"><strong>{money(snackPrice(selected))}</strong>
                  <div className="snack-quantity">
                    <button className="button icon-button" aria-label={'Remove ' + name} onClick={() => update(selected, -1)} disabled={!quantity}><Minus size={16}/></button>
                    <output aria-label={name + ' quantity'}>{quantity}</output>
                    <button className="button icon-button" aria-label={'Add ' + name} onClick={() => update(selected, 1)} disabled={quantity >= maxSnackQuantity}><Plus size={16}/></button>
                  </div>
                </div>
              </div>
            </article>
          })}
        </section>
      </div>
      <aside className="panel snack-review">
        <div><h2>Your add-ons</h2><p>Optional demo concessions</p></div>
        {!!cart.length && <ul className="snack-cart">{cart.map(item => <li key={item.id}><span>{item.quantity} × {item.name}</span><strong>{money(item.price * item.quantity)}</strong><button className="button icon-button" aria-label={'Remove one ' + item.name + ' from cart'} onClick={() => update(item.id, -1)}><Minus size={14}/></button></li>)}</ul>}
        <strong className="snack-subtotal" aria-live="polite">Snacks subtotal {money(snackTotal(cart))}</strong>
        <div className="snack-review-actions">
          <button className="button primary" onClick={() => review(choices)}>Continue to review <ArrowRight size={17}/></button>
          <button className="button secondary" onClick={() => review([])}>Skip to review</button>
        </div>
      </aside>
    </div>
  </main>
}

export function BookingSummary() {
  const {id = ''} = useParams()
  const draft = readDraft(id)
  const request = useApi<ShowWithSeats>(draft ? '/shows/' + id + '/seats' : null)
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [paymentNotice, setPaymentNotice] = useState('')
  const [showRecovery, setShowRecovery] = useState(false)
  const [holdExpiresAt, setHoldExpiresAt] = useState('')
  const config = useApi<{mode: PaymentMode}>('/payments/config')
  const show = request.data
  const seats = show?.seats.filter(seat => draft?.seatIds.includes(seat.id)) ?? []
  const changed = !!show && !!draft && (seats.length !== draft.seatIds.length || seats.some(seat => seat.booked || !seat.enabled))
  const snacks = priceSnacks(draft?.snacks ?? [])
  const reference = useApi<{reference: string; submitted: boolean}>(draft ? '/bookings/requests/' + draft.requestId : null)
  if (reference.data?.submitted) return <main className="shell page"><PageTitle title="Booking already submitted"/><Link className="button primary" to={'/bookings/' + reference.data.reference + '/confirmed'}>View confirmation</Link></main>
  if (!draft) return <main className="shell page"><Empty title="Choose your seats first"><Link className="button primary" to={'/shows/' + id + '/seats'}>Choose seats</Link></Empty></main>
  if (!show) return <main className="shell page">{request.loading ? <Loading/> : <Failure error={request.error || 'Show unavailable.'} retry={request.retry}/>}</main>
  function confirmed(bookingReference: string) {
    sessionStorage.removeItem(draftKey(id))
    navigate('/bookings/' + bookingReference + '/confirmed', {replace: true})
  }
  function handlePayment(result: PaymentResult) {
    if (result.status === 'confirmed') confirmed(result.reference)
    else if (result.status === 'review') setError('The test payment arrived after the hold expired. No ticket was issued. Ask the cinema administrator to review the payment.')
    else if (result.status === 'expired' && draft) {
      sessionStorage.setItem(draftKey(id), JSON.stringify({...draft, requestId: crypto.randomUUID()}))
      setShowRecovery(false)
      setHoldExpiresAt('')
      request.retry()
      setPaymentNotice('The hold expired. Continue to start a new test checkout.')
    } else setPaymentNotice('Payment confirmation is pending. Check the status before trying again.')
  }
  async function recover() {
    if (!draft) return
    setPending(true)
    setError('')
    try {
      const {data} = await api.post<PaymentResult>('/payments/recover', {requestId: draft.requestId})
      handlePayment(data)
    } catch (error) {setError(errorMessage(error))}
    finally {setPending(false)}
  }
  async function book() {
    if (!draft || !config.data) return
    setPending(true)
    setError('')
    setPaymentNotice('')
    try {
      if (config.data.mode === 'demo') {
        const {data} = await api.post<Booking>('/bookings', {showId: id, ...draft})
        confirmed(data.reference)
        return
      }
      const Checkout = await loadCheckout()
      const {data} = await api.post<PaymentResult>('/payments/orders', {showId: id, ...draft})
      if (data.status !== 'ready') {handlePayment(data); return}
      setShowRecovery(true)
      setHoldExpiresAt(data.expiresAt)
      const result = await new Promise<{razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string} | null>(resolve => {
        new Checkout({
          key: data.keyId, order_id: data.orderId, amount: data.amount, currency: 'INR',
          name: 'ScreenPass', description: 'Test payment · No real money charged', theme: {color: '#e50914'},
          handler: resolve, modal: {ondismiss: () => resolve(null)},
        }).open()
      })
      if (!result) {
        setPaymentNotice('Checkout closed. You can reopen it while your seats are held or check the payment status.')
        return
      }
      const verified = await api.post<PaymentResult>('/payments/verify', {
        orderId: result.razorpay_order_id, paymentId: result.razorpay_payment_id, signature: result.razorpay_signature,
      })
      handlePayment(verified.data)
    } catch (error) {setError(error instanceof Error && !('isAxiosError' in error) ? error.message : errorMessage(error))}
    finally {setPending(false)}
  }

  return <main className="shell page">
    {!pending && !showRecovery && <div className="review-navigation">
      <Link className="button secondary" to={'/shows/' + id + '/snacks'}><ArrowLeft size={16}/> Back to snacks &amp; drinks</Link>
      <Link className="button quiet" to={'/shows/' + id + '/seats'}>Change seats</Link>
    </div>}
    <PageTitle eyebrow="Demo show" title="Booking summary"/>
    <div className="checkout-grid">
      <div className="panel booking-overview"><Poster path={show.movie.poster} title={show.movie.title}/><div><h2>{show.movie.title}</h2><ShowInfo show={show}/><p className="inline-note">Booking reference {reference.data?.reference ?? "· Loading…"}</p></div></div>
      <Order seats={seats} snacks={snacks} action={<>
        {changed && <Failure error="One or more seats are unavailable. Return to seat selection to choose again."/>}
        {reference.error && <Failure error={reference.error} retry={reference.retry}/>}
        {error && <Failure error={error}/>}
        {config.error && <Failure error={config.error} retry={config.retry}/>}
        {config.data?.mode === 'unavailable' && <Failure error="Test checkout is currently unavailable."/>}
        {paymentNotice && <p className="inline-note" role="status">{paymentNotice}</p>}
        {config.data?.mode === 'razorpay-test' && <p className="inline-note">Test payment · No real money is charged.</p>}
        {holdExpiresAt && <p className="inline-note">Seat hold expires at {showTime(holdExpiresAt)} IST.</p>}
        <button className="button primary wide" onClick={book} disabled={pending || changed || !reference.data || !config.data || config.data.mode === 'unavailable'}>
          <Ticket size={17}/> {pending ? 'Processing…' : config.data?.mode === 'razorpay-test' ? 'Pay ' + money(seats.reduce((sum, seat) => sum + seat.price, snackTotal(snacks))) + ' · Test mode' : 'Confirm demo booking'}
        </button>
        {showRecovery && <button className="button quiet wide" onClick={recover} disabled={pending}>Check payment status</button>}
      </>}/>
    </div>
  </main>
}

function Status({status}: {status: string}) {return <span className={'status ' + status.toLowerCase()}>{status.toLowerCase()}</span>}
function BookingFacts({booking}: {booking: Booking}) {
  return <dl className="booking-facts"><div><dt>Cinema</dt><dd>{booking.cinemaName}</dd></div><div><dt>Screen</dt><dd>{screenLabel(booking.screenName)}</dd></div><div><dt>Showtime</dt><dd>{showDate(booking.startsAt)} · {showTime(booking.startsAt)} IST</dd></div><div><dt>Seats</dt><dd>{booking.seats.map(seat => seat.label).join(', ')}</dd></div>{!!booking.snacks?.length && <div><dt>Snacks &amp; Drinks</dt><dd>{booking.snacks.map(item => item.quantity + ' × ' + item.name).join(', ')}</dd></div>}<div><dt>Demo total</dt><dd>{money(booking.total)}</dd></div><div><dt>Reference</dt><dd>{booking.reference}</dd></div>{booking.payment?.status === 'CONFIRMED' && <div><dt>Payment</dt><dd>Test payment verified</dd></div>}</dl>
}

export function Confirmation() {
  const {reference} = useParams()
  const request = useApi<Booking>('/bookings/' + reference)
  const booking = request.data
  return <main className="shell page narrow">
    {request.loading ? <Loading/> : request.error ? <Failure error={request.error} retry={request.retry}/> : booking && <>
      <div className="confirmation-icon"><CheckCircle2 size={35}/></div>
      <PageTitle title={booking.status === 'CONFIRMED' ? 'Booking confirmed' : 'Booking cancelled'} subtitle={booking.movieTitle}/>
      <div className="panel confirmation"><BookingFacts booking={booking}/><DemoNote/>
        <div className="actions"><Link className="button primary" to={'/tickets/' + booking.reference}><Ticket size={17}/> View ticket</Link><Link className="button secondary" to="/bookings">My bookings</Link></div>
      </div>
    </>}
  </main>
}

export function BookingHistory() {
  const request = useApi<Booking[]>('/bookings')
  const {notify} = useApp()
  const [filter, setFilter] = useState('Upcoming')
  const [selected, setSelected] = useState<Booking | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const records = request.data?.filter(booking => {
    if (filter === 'Cancelled') return booking.status === 'CANCELLED'
    return booking.status === 'CONFIRMED' && (filter === 'Upcoming' ? Date.parse(booking.startsAt) > Date.now() : Date.parse(booking.startsAt) <= Date.now())
  })
  async function cancel() {
    if (!selected) return
    setPending(true)
    setError('')
    try {
      await api.post('/bookings/' + selected.reference + '/cancel')
      setSelected(null)
      request.retry()
      notify('Booking cancelled. Your seats were released.')
    } catch (error) {setError(errorMessage(error))}
    finally {setPending(false)}
  }
  return <main className="shell page"><PageTitle title="My bookings" subtitle="Cancel confirmed demo bookings more than 30 minutes before showtime."/>
    <div className="tabs history-tabs">{['Upcoming', 'Past', 'Cancelled'].map(label => <button className={label === filter ? 'active' : ''} onClick={() => setFilter(label)} key={label}>{label}</button>)}</div>
    {request.loading && <Loading/>}{request.error && <Failure error={request.error} retry={request.retry}/>}
    {records?.length === 0 && <Empty title={'No ' + filter.toLowerCase() + ' bookings'}><Link className="button secondary" to="/movies">Explore movies</Link></Empty>}
    <div className="cinema-list">{records?.map(booking => <article className="panel history-card" key={booking.reference}>
      <Poster path={booking.poster} title={booking.movieTitle}/><div><div className="history-heading"><h2>{booking.movieTitle}</h2><Status status={booking.status}/></div><BookingFacts booking={booking}/></div>
      <div className="actions"><Link className="button secondary" to={'/tickets/' + booking.reference}>View ticket</Link>{booking.canCancel && <button className="button quiet" onClick={() => {setSelected(booking); setError('')}}>Cancel booking</button>}</div>
    </article>)}</div>
    {selected && <Modal title="Cancel this booking?" onClose={() => {if (!pending) setSelected(null)}}><p>The seats will become available and the QR ticket will be marked cancelled.</p>{error && <Failure error={error}/>}<div className="actions"><button className="button secondary" onClick={() => setSelected(null)} disabled={pending}>Keep booking</button><button className="button primary" disabled={pending} onClick={cancel}>{pending ? 'Cancelling…' : 'Cancel booking'}</button></div></Modal>}
  </main>
}

export function TicketDetails() {
  const {reference} = useParams()
  const request = useApi<Booking>('/bookings/' + reference + '/ticket')
  const ticket = request.data
  return <main className="shell page">
    <Link className="breadcrumb" to="/bookings"><ArrowLeft size={15}/> My bookings</Link>
    <PageTitle eyebrow="ScreenPass" title="Your digital ticket"/>
    {request.loading && <Loading/>}{request.error && <Failure error={request.error} retry={request.retry}/>}
    {ticket && <><article className="digital-ticket panel"><div className="ticket-main"><Poster path={ticket.poster} title={ticket.movieTitle}/><div><Status status={ticket.status}/><h2>{ticket.movieTitle}</h2><BookingFacts booking={ticket}/><DemoNote/></div></div>
      <div className="ticket-stub">{ticket.qr ? <><img src={ticket.qr} alt="Ticket verification QR code"/><p>Scan to verify</p></> : <><Armchair size={34}/><p>Ticket cancelled</p></>}</div>
    </article>{ticket.qr && <button className="button secondary print-button" onClick={() => window.print()}><Printer size={17}/> Print ticket</button>}</>}
  </main>
}

export function VerifyTicket() {
  const {token} = useParams()
  const request = useApi<{status: string; reference?: string}>('/tickets/verify/' + token)
  const status = request.data?.status
  return <main className="shell page narrow"><PageTitle title="Ticket verification"/>
    {request.loading ? <Loading/> : status ? <div className="panel confirmation"><Status status={status}/><p>{status === 'VALID' ? 'Confirmed ScreenPass demo ticket' : 'This ScreenPass ticket has been cancelled.'}</p><p>{request.data?.reference}</p></div> : request.error && <Failure error={request.error === 'This ticket is invalid.' ? request.error : 'Verification is unavailable. Please try again.'} retry={request.retry}/>}
  </main>
}
