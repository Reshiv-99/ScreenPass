export function seatLayout(rows: number, seatsPerRow: number, premiumRows: number) {
  return Array.from({length: rows}, (_, row) => Array.from({length: seatsPerRow}, (_, seat) => ({
    row: String.fromCharCode(65 + row), number: seat + 1,
    category: row >= rows - premiumRows ? 'PREMIUM' as const : 'STANDARD' as const,
  }))).flat()
}

export const demoSeatPrices = {STANDARD: 350, PREMIUM: 550, RECLINER: 750}

export function demoSeatLayout(seatsPerRow: number) {
  return seatLayout(8, seatsPerRow, 4).map(seat => ({
    ...seat, category: seat.row === 'H' ? 'RECLINER' as const : seat.category,
  }))
}
