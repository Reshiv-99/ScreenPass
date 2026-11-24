import { z } from 'zod'

const variants = {
  popcorn: {name: 'Classic Popcorn', price: 199},
  'popcorn-small': {name: 'Classic Popcorn (Small)', price: 119},
  'popcorn-medium': {name: 'Classic Popcorn (Medium)', price: 159},
  sandwich: {name: 'Grilled Veg Sandwich', price: 179},
  chips: {name: 'Cheese Nachos', price: 169},
  burger: {name: 'Crispy Veg Burger', price: 189},
  'cola-small': {name: 'Coca-Cola (Small)', price: 89},
  'cola-medium': {name: 'Coca-Cola (Medium)', price: 119},
  'cola-large': {name: 'Coca-Cola (Large)', price: 149},
  'thums-small': {name: 'Thums Up (Small)', price: 89},
  'thums-medium': {name: 'Thums Up (Medium)', price: 119},
  'thums-large': {name: 'Thums Up (Large)', price: 149},
  'sprite-small': {name: 'Sprite (Small)', price: 89},
  'sprite-medium': {name: 'Sprite (Medium)', price: 119},
  'sprite-large': {name: 'Sprite (Large)', price: 149},
  combo: {name: 'Popcorn & Cola Combo', price: 299},
  nachos: {name: 'Nachos Combo', price: 329},
  'burger-duo': {name: 'ScreenPass Duo', price: 499},
} as const

type SnackId = keyof typeof variants
const ids = Object.keys(variants) as [SnackId, ...SnackId[]]
type MenuProduct = {name: string; description: string; image: string; options: readonly SnackId[]}
export const sizes = ['Small', 'Medium', 'Large'] as const
export const snackSections = {
  Food: [
    {name: 'Classic Popcorn', description: 'Warm, lightly salted butter popcorn.', image: 'popcorn', options: ['popcorn-small', 'popcorn-medium', 'popcorn']},
    {name: 'Grilled Veg Sandwich', description: 'Toasted bread with vegetables and melted cheese.', image: 'sandwich', options: ['sandwich']},
    {name: 'Cheese Nachos', description: 'Crunchy tortilla chips with warm cheese dip.', image: 'chips', options: ['chips']},
    {name: 'Crispy Veg Burger', description: 'A crispy veg patty, melted cheese, and lettuce in a toasted bun.', image: 'burger', options: ['burger']},
  ],
  Drinks: [
    {name: 'Coca-Cola', description: 'Original cola, served chilled.', image: 'cola', options: ['cola-small', 'cola-medium', 'cola-large']},
    {name: 'Thums Up', description: 'Bold, fizzy cola, served chilled.', image: 'thums', options: ['thums-small', 'thums-medium', 'thums-large']},
    {name: 'Sprite', description: 'Crisp lemon-lime soda, served chilled.', image: 'sprite', options: ['sprite-small', 'sprite-medium', 'sprite-large']},
  ],
  Combos: [
    {name: 'Popcorn & Cola Combo', description: 'Large butter popcorn and a medium Coca-Cola.', image: 'combo', options: ['combo']},
    {name: 'Nachos Combo', description: 'Cheese nachos with warm dip and a large Thums Up.', image: 'nachos', options: ['nachos']},
    {name: 'ScreenPass Duo', description: 'Crispy veg burger, grilled veg sandwich, and two medium Sprites.', image: 'burger-duo', options: ['burger-duo']},
  ],
} as const satisfies Record<string, readonly MenuProduct[]>

export const maxSnackQuantity = 5
export const snackChoices = z.array(z.object({
  id: z.enum(ids),
  quantity: z.number().int().min(1).max(maxSnackQuantity),
})).max(ids.length).refine(items => new Set(items.map(item => item.id)).size === items.length, 'Choose each snack size once.')

export const snackPrice = (id: SnackId) => variants[id].price

export type SnackChoice = z.infer<typeof snackChoices>[number]
export type SnackItem = {id: string; name: string; quantity: number; price: number}

export function priceSnacks(choices: SnackChoice[]) {
  return [...choices].sort((a, b) => a.id.localeCompare(b.id)).map(({id, quantity}) => {
    const {name, price} = variants[id]
    return {id, name: id === 'popcorn' ? name + ' (Large)' : name, price, quantity}
  })
}

export const snackTotal = (items: SnackItem[]) => items.reduce((total, item) => total + item.price * item.quantity, 0)

// MySQL can reorder keys within JSON objects.
export function sameSnacks(saved: unknown, items: SnackItem[]) {
  const previous = (saved ?? []) as SnackItem[]
  return previous.length === items.length && items.every((item, index) =>
    previous[index].id === item.id && previous[index].quantity === item.quantity,
  )
}
