import { Bell, Eye, EyeOff, LogOut, Ticket, UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { api, Empty, errorMessage, Failure, Loading, PageTitle, SectionTitle, useApi, useApp, type Subscription, type User } from './core'

export function AuthForm({signup = false}: {signup?: boolean}) {
  const [params] = useSearchParams()
  const {user, setUser} = useApp()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const next = params.get('next') || '/profile'
  const target = /^\/(?![\\/])/.test(next) ? next : '/profile'
  if (user) return <Navigate to={target} replace/>
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      const {data} = await api.post<User>(signup ? '/auth/signup' : '/auth/login', Object.fromEntries(new FormData(event.currentTarget)))
      setUser(data)
      navigate(target, {replace: true})
    } catch (error) {setError(errorMessage(error))}
    finally {setPending(false)}
  }
  return <main className="shell page auth-page"><div className="panel auth-card">
    <div className="auth-icon"><UserRound size={24}/></div>
    <PageTitle title={signup ? 'Create your account' : 'Welcome back'} subtitle={signup ? 'Sign up to book demo tickets and follow movie releases.' : 'Sign in to manage your ScreenPass bookings.'}/>
    <form className="form" onSubmit={submit}>
      {signup && <label>Name<input name="name" autoComplete="name" minLength={2} maxLength={80} required/></label>}
      <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254}/></label>
      <div className="password-field">
        <label htmlFor="account-password">Password</label>
        <div className="password-input">
          <input id="account-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} minLength={8} maxLength={72} required/>
          <button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowPassword(visible => !visible)}>
            {showPassword ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}
          </button>
        </div>
      </div>
      {error && <Failure error={error}/>}
      <button className="button primary wide" disabled={pending}>{pending ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button>
    </form>
    <p className="auth-switch">{signup ? 'Already have an account?' : 'New to ScreenPass?'} <Link to={(signup ? '/login' : '/signup') + (params.has('next') ? '?next=' + encodeURIComponent(target) : '')}>{signup ? 'Sign in' : 'Create an account'}</Link></p>
  </div></main>
}

export function Profile() {
  const {user, setUser, notify, city} = useApp()
  const navigate = useNavigate()
  const reminders = useApi<Subscription[]>('/notifications')
  const [pending, setPending] = useState(false)
  const [removing, setRemoving] = useState<number | null>(null)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    try {
      const {data} = await api.patch<User>('/auth/me', Object.fromEntries(new FormData(event.currentTarget)))
      setUser(data)
      notify('Profile updated.')
    } catch (error) {notify(errorMessage(error), 'error')}
    finally {setPending(false)}
  }
  async function logout() {
    setPending(true)
    try {await api.post('/auth/logout'); setUser(null); navigate('/')}
    catch (error) {notify(errorMessage(error), 'error')}
    finally {setPending(false)}
  }
  async function remove(id: number) {
    setRemoving(id)
    try {await api.delete('/notifications/' + id); reminders.retry(); notify('Reminder removed.')}
    catch (error) {notify(errorMessage(error), 'error')}
    finally {setRemoving(null)}
  }
  return <main className="shell page">
    <div className="profile-heading">
      <PageTitle title="Your profile" subtitle={'Browsing in ' + city.name}/>
      <Link className="button primary" to="/bookings"><Ticket size={17} aria-hidden="true"/> My bookings</Link>
    </div>
    <div className="profile-grid"><div className="panel account-panel"><SectionTitle title="Account details"/>
      <form className="form" onSubmit={save}><label>Name<input defaultValue={user?.name} name="name" minLength={2} maxLength={80} required/></label><label>Email address<input value={user?.email || ''} readOnly/></label><button className="button primary" disabled={pending}>Save profile</button></form>
      <div className="actions">{user && user.role !== 'CUSTOMER' && <Link className="button secondary" to="/admin">Admin dashboard</Link>}<button className="button quiet" disabled={pending} onClick={logout}><LogOut size={16}/> Sign out</button></div>
    </div><div className="panel account-panel"><SectionTitle title="Release reminders" subtitle="Release status is available here in your profile."/>
      {reminders.loading && <Loading/>}{reminders.error && <Failure error={reminders.error} retry={reminders.retry}/>}
      {reminders.data?.length === 0 && <Empty title="No release reminders"><Link className="button secondary" to="/upcoming">Browse upcoming movies</Link></Empty>}
      {reminders.data?.map(item => <div className="reminder" key={item.tmdbId}><Bell size={19}/><div><Link to={'/movies/' + item.tmdbId}>{item.title}</Link><p>{item.released ? 'Released' : item.releaseDate ? 'Expected ' + item.releaseDate : 'Release date to be announced'}</p></div><button className="button quiet" disabled={removing !== null} onClick={() => remove(item.tmdbId)}>Remove</button></div>)}
    </div></div>
  </main>
}
