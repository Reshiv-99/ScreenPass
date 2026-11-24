// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { DemoNote, Empty, Poster } from '../web/src/core'
import { MovieCard } from '../web/src/movies'
import { samples } from '../server/src/catalogue'

afterEach(cleanup)

test('links the poster and film title to the details route', () => {
  render(<MemoryRouter><MovieCard film={samples[0]}/></MemoryRouter>)
  expect(screen.getByRole('link', {name: 'View Dune: Part Two'}).getAttribute('href')).toBe('/movies/693134')
  expect(screen.getByRole('img', {name: 'Dune: Part Two poster'}).getAttribute('src')).toContain('/posters/')
})

test('renders missing artwork gracefully and discloses demo payment status', () => {
  render(<><Poster title="Missing poster"/><Empty title="No matches"/><DemoNote/></>)
  expect(screen.getByText('Missing poster')).toBeTruthy()
  expect(screen.getByRole('heading', {name: 'No matches'})).toBeTruthy()
  expect(screen.getByText(/No payment will be collected/)).toBeTruthy()
})
