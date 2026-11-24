import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

const currentFilm = {id: 9990001, title: 'Current release fixture', poster_path: null, backdrop_path: null, overview: 'A current film.', genre_ids: [], vote_average: 7}
const today = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Kolkata'}).format(new Date())
const tomorrow = new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10)

async function mockCurrentFilm(page: Page) {
  await page.route('**/api/movies/' + currentFilm.id, route => route.fulfill({json: {
    ...currentFilm, release_date: today, india_release_date: today, source: 'tmdb',
  }}))
}

test('checks out as a new customer, opens the QR ticket and cancels', async ({page}) => {
  const config = await page.request.get('/api/payments/config')
  expect(await config.json(), 'Run this checkout test against a demo-mode API with both Razorpay keys empty.').toEqual({mode: 'demo'})
  const result = await page.request.get('/api/shows?city=delhi&movie=693134')
  expect(result.ok()).toBeTruthy()
  const shows = await result.json()
  await page.goto('/shows/' + shows[0].id + '/seats')
  await expect(page.getByRole('heading', {name: 'Choose your seats'})).toBeVisible()
  await page.getByRole('button', {name: /Seat A2, classic/}).click()
  await page.getByRole('button', {name: 'Continue'}).click()
  await page.getByRole('button', {name: 'Skip to review'}).click()
  await page.getByRole('link', {name: 'Create an account'}).click()
  await page.getByLabel('Name', {exact: true}).fill('Browser Test')
  await page.getByLabel('Email address').fill(`browser-${randomUUID()}@screenpass.test`)
  await page.getByLabel('Password', {exact: true}).fill('ScreenPass-tests-only!')
  await page.getByRole('button', {name: 'Create account'}).click()
  await expect(page.getByRole('heading', {name: 'Booking summary'})).toBeVisible()
  const reference = await page.getByText(/Booking reference SP-/).textContent()
  await page.getByRole('button', {name: 'Confirm demo booking'}).click()
  await expect(page.getByRole('heading', {name: 'Booking confirmed'})).toBeVisible()
  await expect(page.getByText(reference!.replace('Booking reference ', ''), {exact: true})).toBeVisible()
  await page.getByRole('link', {name: 'View ticket'}).click()
  await expect(page.getByRole('img', {name: 'Ticket verification QR code'})).toBeVisible()
  await page.locator('main').getByRole('link', {name: 'My bookings'}).click()
  await page.getByRole('button', {name: 'Cancel booking'}).click()
  await page.getByRole('dialog').getByRole('button', {name: 'Cancel booking'}).click()
  await page.getByRole('button', {name: 'Cancelled', exact: true}).click()
  await expect(page.getByRole('heading', {name: 'Dune: Part Two'})).toBeVisible()
  await page.getByRole('link', {name: 'View ticket'}).click()
  await expect(page.getByText('Ticket cancelled')).toBeVisible()
  const navigation = page.getByRole('navigation', {name: 'Main navigation'})
  await expect(navigation.getByRole('link', {name: 'My bookings'})).toBeVisible()
  await page.getByRole('link', {name: 'Your profile'}).click()
  await page.setViewportSize({width: 390, height: 844})
  const profileBookings = page.locator('main').getByRole('link', {name: 'My bookings'})
  await expect(profileBookings).toBeInViewport()
  await page.getByLabel('Name', {exact: true}).fill('Updated browser customer')
  await page.getByRole('button', {name: 'Save profile'}).click()
  await expect(page.getByText('Profile updated.')).toBeVisible()
  await profileBookings.click()
  await expect(page.getByRole('heading', {name: 'My bookings', exact: true})).toBeVisible()
})

test('supports mobile navigation, search, and city persistence', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844})
  await page.goto('/')
  await page.getByRole('button', {name: 'Delhi'}).click()
  await page.getByRole('button', {name: 'Mumbai', exact: true}).click()
  await page.getByRole('button', {name: 'Toggle navigation'}).click()
  const navigation = page.getByRole('navigation', {name: 'Main navigation'})
  await expect(navigation.getByRole('link', {name: 'Cinemas'})).toHaveCount(0)
  await navigation.getByRole('link', {name: 'Movies', exact: true}).click()
  await mockCurrentFilm(page)
  await page.goto('/movies/' + currentFilm.id)
  await expect(page.getByRole('heading', {name: 'ScreenPass Demo Cinema · Mumbai'})).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', {name: 'ScreenPass Demo Cinema · Mumbai'})).toBeVisible()
  await page.goto('/cinemas')
  await expect(page).toHaveURL('/movies')
  await page.route('**/api/movies/list/search?*', route => route.fulfill({json: {results: [{...currentFilm, release_date: today}], source: 'tmdb', page: 1, total_pages: 1}}))
  await page.getByRole('searchbox', {name: 'Search movies'}).fill('Current release')
  await expect(page.getByRole('link', {name: 'View Current release fixture', exact: true})).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

test('opens protected admin inventory and renders the 404 page', async ({page}) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', {name: 'Welcome back'})).toBeVisible()
  await page.getByLabel('Email address').fill(process.env.ADMIN_EMAIL!)
  await page.getByLabel('Password', {exact: true}).fill(process.env.ADMIN_PASSWORD!)
  await page.locator('main').getByRole('button', {name: 'Sign in'}).click()
  await expect(page.getByRole('heading', {name: 'Inventory dashboard'})).toBeVisible()
  await page.getByRole('button', {name: 'Screens', exact: true}).click()
  await page.getByRole('button', {name: 'Manage seats'}).first().click()
  await expect(page.getByRole('button', {name: 'A1', exact: true})).toBeVisible()
  await page.goto('/not-a-real-page')
  await expect(page.getByRole('heading', {name: 'Page not found'})).toBeVisible()
})

test('detects Fatehabad outside the preset list, persists it, and validates manual city selection', async ({context, page}) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({latitude: 29.515, longitude: 75.455})
  await page.route('https://api.bigdatacloud.net/data/reverse-geocode-client?*', async route => {
    const params = new URL(route.request().url()).searchParams
    expect(params.get('latitude')).toBe('29.515')
    expect(params.get('longitude')).toBe('75.455')
    await route.fulfill({json: {city: 'Fatehabad', principalSubdivision: 'Haryana', lookupSource: 'reverseGeocoding'}})
  })
  await mockCurrentFilm(page)
  await page.goto('/movies/' + currentFilm.id)
  await page.getByRole('button', {name: 'Delhi', exact: true}).click()
  await page.getByRole('button', {name: 'Use my location'}).click()
  await expect(page.getByRole('button', {name: 'Fatehabad', exact: true})).toBeVisible()
  await expect(page.getByRole('heading', {name: 'ScreenPass Demo Cinema · Fatehabad'})).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', {name: 'Fatehabad', exact: true})).toBeVisible()
  await page.getByRole('button', {name: 'Fatehabad', exact: true}).click()
  const citySearch = page.getByRole('combobox', {name: 'Search Indian cities'})
  await citySearch.fill('F')
  await expect(page.getByRole('option').first()).toBeVisible()
  for (const option of await page.getByRole('option').all()) await expect(option).toHaveText(/^F/i)
  await citySearch.fill('Fatehabad')
  await expect(page.getByRole('option', {name: 'Fatehabad Haryana'})).toBeVisible()
  await citySearch.fill('NotARealCity123')
  await citySearch.press('Enter')
  await expect(page.getByText('No matching city. Try a different spelling.')).toBeVisible()
  await expect(page.getByRole('option')).toHaveCount(0)
  await citySearch.fill('Hisar')
  await expect(page.getByRole('option', {name: 'Hisar Haryana'})).toBeVisible()
  await citySearch.press('ArrowDown')
  await citySearch.press('Enter')
  await expect(page.getByRole('button', {name: 'Hisar', exact: true})).toBeVisible()
})


test('shows release-day notice for an upcoming film and timings when released', async ({page}) => {
  await page.route('**/api/movies/' + currentFilm.id, route => route.fulfill({json: {
    ...currentFilm, release_date: tomorrow, india_release_date: tomorrow, source: 'tmdb',
  }}))
  await page.goto('/movies/' + currentFilm.id)
  await expect(page.getByRole('heading', {name: 'Demo showtimes open on release day'})).toBeVisible()
  await expect(page.getByRole('button', {name: /Choose seats/})).toHaveCount(0)
  await page.unroute('**/api/movies/' + currentFilm.id)
  await mockCurrentFilm(page)
  await page.reload()
  await expect(page.getByRole('heading', {name: 'ScreenPass Demo Cinema · Delhi'})).toBeVisible()
  await expect(page.getByRole('button', {name: /Choose seats/}).first()).toBeVisible()
})

test('keeps the last catalogue page visible when pagination fails and recovers on retry', async ({page}) => {
  await page.clock.install()
  let attempts = 0
  await page.route('**/api/movies/list/now-playing?*', route => {
    const requested = Number(new URL(route.request().url()).searchParams.get('page'))
    if (requested === 2 && ++attempts === 1) {
      return route.fulfill({json: {source: 'unavailable', page: 2, results: [], total_pages: 1}})
    }
    const title = requested === 1 ? 'First page release' : 'Second page release'
    return route.fulfill({json: {source: 'tmdb', page: requested, results: [{...currentFilm, title, release_date: today}], total_pages: 2}})
  })
  await page.goto('/movies')
  await expect(page.getByRole('link', {name: 'View First page release'})).toBeVisible()
  await page.getByRole('button', {name: 'Next'}).click()
  await expect(page.getByText('Page 2 couldn’t load. Still showing page 1.')).toBeVisible()
  await expect(page.getByRole('link', {name: 'View First page release'})).toBeVisible()
  await page.getByRole('button', {name: 'Try again'}).click()
  await expect(page.getByRole('link', {name: 'View Second page release'})).toBeVisible()
  await expect(page.getByText('Page 2', {exact: true})).toBeVisible()
  await page.clock.fastForward(300)
  await expect(page.getByText('Page 2', {exact: true})).toBeVisible()
  await page.getByRole('button', {name: 'Previous'}).click()
  await expect(page.getByRole('link', {name: 'View First page release'})).toBeVisible()
})

test('opens the Upcoming catalogue, opens its trailer, and verifies invalid tickets', async ({page}) => {
  const future = {...currentFilm, title: 'Upcoming fixture', release_date: tomorrow, india_release_date: tomorrow}
  await page.route('**/api/movies/list/upcoming?*', route => route.fulfill({json: {source: 'tmdb', page: 1, total_pages: 1, results: [future]}}))
  await page.route('**/api/movies/' + future.id, route => route.fulfill({json: {...future, source: 'tmdb'}}))
  await page.route('**/api/movies/' + future.id + '/videos', route => route.fulfill({json: {results: [{id: 'fixture', key: 'Way9Dexny3w', type: 'Trailer', site: 'YouTube'}]}}))
  await page.goto('/upcoming')
  await expect(page.getByRole('heading', {name: 'Upcoming movies'})).toBeVisible()
  await page.getByRole('link', {name: 'View Upcoming fixture'}).click()
  await page.getByRole('button', {name: 'Watch trailer'}).click()
  await expect(page.getByRole('dialog').locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com/)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/verify/invalid')
  await expect(page.getByRole('heading', {name: 'Ticket verification'})).toBeVisible()
  await expect(page.getByText('This ticket is invalid.')).toBeVisible()
})


test('lets the cinema owner grant and revoke admin access from Users', async ({page, browser, baseURL}) => {
  const staffContext = await browser.newContext({baseURL})
  const staff = await staffContext.newPage()
  const email = `staff-${randomUUID()}@screenpass.test`
  try {
    const signup = await staff.request.post('/api/auth/signup', {data: {
      name: 'Cinema staff test', email, password: 'ScreenPass-tests-only!',
    }})
    expect(signup.status()).toBe(201)
    await page.goto('/admin')
    await page.getByLabel('Email address').fill(process.env.ADMIN_EMAIL!)
    await page.getByLabel('Password', {exact: true}).fill(process.env.ADMIN_PASSWORD!)
    await page.locator('main').getByRole('button', {name: 'Sign in'}).click()
    await page.getByRole('button', {name: 'Users', exact: true}).click()
    await page.getByLabel('Account email').fill(email)
    await page.getByRole('button', {name: 'Find account'}).click()
    await page.getByRole('button', {name: 'Grant admin access'}).click()
    await page.getByRole('dialog').getByRole('button', {name: 'Confirm'}).click()
    await expect(page.getByRole('button', {name: 'Revoke admin access'})).toBeVisible()
    await staff.goto('/admin')
    await expect(staff.getByRole('heading', {name: 'Inventory dashboard'})).toBeVisible()
    await page.getByRole('button', {name: 'Revoke admin access'}).click()
    await page.getByRole('dialog').getByRole('button', {name: 'Confirm'}).click()
    await expect(page.getByRole('button', {name: 'Grant admin access'})).toBeVisible()
    await staff.reload()
    await expect(staff.getByRole('heading', {name: 'Admin access required'})).toBeVisible()
  } finally {
    await staffContext.close()
  }
})

test('toggles password visibility on sign-in and signup without submitting', async ({page}) => {
  for (const path of ['/login', '/signup']) {
    await page.goto(path)
    const password = page.getByLabel('Password', {exact: true})
    await password.fill('ScreenPass-visibility-test!')
    await expect(password).toHaveAttribute('type', 'password')
    await page.getByRole('button', {name: 'Show password', exact: true}).click()
    await expect(password).toHaveAttribute('type', 'text')
    await expect(password).toHaveValue('ScreenPass-visibility-test!')
    await page.getByRole('button', {name: 'Hide password', exact: true}).press('Enter')
    await expect(password).toHaveAttribute('type', 'password')
    await expect(password).toHaveValue('ScreenPass-visibility-test!')
    await expect(page).toHaveURL(path)
  }
})

test('opens Razorpay Test Mode and waits for server verification before confirmation', async ({page}) => {
  const signup = await page.request.post('/api/auth/signup', {data: {
    name: 'Payment browser fixture', email: 'payment-' + randomUUID() + '@screenpass.test', password: 'ScreenPass-tests-only!',
  }})
  expect(signup.status()).toBe(201)
  await page.addInitScript(() => {
    window.Razorpay = class {
      constructor(private options: {handler: (data: {razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string}) => void}) {}
      open() {
        this.options.handler({razorpay_order_id: 'order_Browser', razorpay_payment_id: 'pay_Browser', razorpay_signature: 'a'.repeat(64)})
      }
    }
  })
  await page.route('**/api/payments/config', route => route.fulfill({json: {mode: 'razorpay-test'}}))
  await page.route('**/api/payments/orders', route => {
    expect(route.request().postDataJSON().seatIds).toHaveLength(3)
    expect(route.request().postDataJSON().snacks).toEqual([{id: 'popcorn-medium', quantity: 1}, {id: 'sprite-large', quantity: 1}, {id: 'combo', quantity: 1}])
    return route.fulfill({json: {status: 'ready', orderId: 'order_Browser', keyId: 'rzp_test_browser', amount: 225700, expiresAt: new Date(Date.now() + 600000).toISOString()}})
  })
  await page.route('**/api/payments/verify', route => {
    expect(route.request().postDataJSON()).toMatchObject({orderId: 'order_Browser', paymentId: 'pay_Browser'})
    return route.fulfill({json: {status: 'confirmed', reference: 'SP-0123456789ABCDEF'}})
  })
  await page.route('**/api/bookings/SP-0123456789ABCDEF', route => route.fulfill({json: {
    reference: 'SP-0123456789ABCDEF', movieTitle: 'Payment browser fixture', cinemaName: 'Demo cinema',
    screenName: 'Screen 1', startsAt: new Date().toISOString(), total: 2257, snacks: [{id: 'combo', name: 'Popcorn & Cola Combo', quantity: 1, price: 299}], status: 'CONFIRMED',
    seats: [{label: 'A2'}, {label: 'F2'}, {label: 'H2'}], payment: {status: 'CONFIRMED', paymentId: 'pay_Browser'},
  }}))
  const shows = await (await page.request.get('/api/shows?city=delhi&movie=693134')).json()
  await page.goto('/shows/' + shows[0].id + '/seats')
  await page.getByRole('button', {name: /Seat A2, classic/}).click()
  await page.getByRole('button', {name: /Seat F2, prime, ₹550/}).click()
  await page.getByRole('button', {name: /Seat H2, recliner, ₹750/}).click()
  await page.getByRole('button', {name: 'Continue'}).click()
  await expect(page.getByRole('heading', {name: 'Add snacks & drinks'})).toBeVisible()
  await expect.poll(() => page.locator('.snack-card img').evaluateAll(images =>
    images.every(image => image instanceof HTMLImageElement && image.naturalWidth > 0),
  )).toBe(true)
  const popcorn = page.locator('.snack-card').filter({has: page.getByRole('heading', {name: 'Classic Popcorn'})})
  await popcorn.getByRole('button', {name: 'Medium'}).click()
  await popcorn.getByRole('button', {name: 'Add Classic Popcorn'}).click()
  await page.getByRole('tab', {name: 'Drinks'}).click()
  const sprite = page.locator('.snack-card').filter({has: page.getByRole('heading', {name: 'Sprite'})})
  await sprite.getByRole('button', {name: 'Large'}).click()
  await sprite.getByRole('button', {name: 'Add Sprite'}).click()
  await page.getByRole('tab', {name: 'Combos'}).click()
  await page.getByRole('button', {name: 'Add Popcorn & Cola Combo'}).click()
  await page.getByRole('button', {name: 'Add Popcorn & Cola Combo'}).click()
  await page.getByRole('button', {name: 'Remove Popcorn & Cola Combo'}).click()
  await expect(page.getByText('Snacks subtotal ₹607')).toBeVisible()
  await page.getByRole('button', {name: 'Continue to review'}).click()
  await expect(page.getByText('1 × Popcorn & Cola Combo')).toBeVisible()
  await page.getByRole('link', {name: 'Back to snacks & drinks'}).click()
  await expect(page.getByRole('heading', {name: 'Add snacks & drinks'})).toBeVisible()
  await expect(page.getByText('Snacks subtotal ₹607')).toBeVisible()
  await page.getByRole('button', {name: 'Continue to review'}).click()
  await page.getByRole('button', {name: /Pay ₹2,257 · Test mode/, exact: true}).click()
  await expect(page.getByRole('heading', {name: 'Booking confirmed'})).toBeVisible()
  await expect(page.getByText('Test payment verified')).toBeVisible()
})

test('uses footer genre navigation and opens booking help on mobile', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844})
  await page.route('**/api/movies/list/now-playing?*', route => {
    const {searchParams} = new URL(route.request().url())
    const genre = searchParams.get('genre')
    return route.fulfill({json: {
      source: 'tmdb', page: 1, total_pages: 1,
      results: [{...currentFilm, title: genre === '878' ? 'Sci-fi release' : 'Current release fixture', release_date: today, genre_ids: [878]}],
    }})
  })
  await page.goto('/movies')
  const footer = page.getByRole('contentinfo')
  await footer.getByRole('link', {name: 'Sci-fi', exact: true}).click()
  await expect(page).toHaveURL('/movies?genre=878')
  await expect(page.getByRole('link', {name: 'View Sci-fi release'})).toBeVisible()
  await page.reload()
  await expect(page.getByRole('link', {name: 'View Sci-fi release'})).toBeVisible()
  await footer.getByRole('button', {name: 'Booking help'}).click()
  await expect(page.getByRole('dialog', {name: 'Booking help'})).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

test('keeps provider attribution on the Credits page', async ({page}) => {
  await page.goto('/')
  const footer = page.getByRole('contentinfo')
  await expect(footer.getByText(/This product uses the TMDB API/)).toHaveCount(0)
  await footer.getByRole('link', {name: 'Credits'}).click()
  await expect(page.getByRole('heading', {name: 'Credits', exact: true})).toBeVisible()
  await expect(page.getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.')).toBeVisible()
  await expect(page.getByRole('img', {name: 'TMDB', exact: true})).toHaveJSProperty('complete', true)
  expect(await page.getByRole('img', {name: 'TMDB', exact: true}).evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
})
