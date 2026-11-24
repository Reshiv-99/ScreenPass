import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import QRCode from 'qrcode'

export type Ticket = {
  reference: string
  movieTitle: string
  cinemaName: string
  screenName: string
  startsAt: Date
  createdAt: Date
  total: number
  seats: {label: string}[]
}

export const ticketDate = (date: Date) => new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
}).format(date) + ' IST'

function printable(font: PDFFont, value: string) {
  return Array.from(value.replace(/[\r\n\t]+/g, ' '), character => {
    try {font.encodeText(character); return character}
    catch {return '?'}
  }).join('')
}

export async function ticketPdf(ticket: Ticket, verificationUrl: string) {
  const pdf = await PDFDocument.create({updateMetadata: false})
  pdf.setTitle('ScreenPass Ticket ' + ticket.reference)
  pdf.setAuthor('ScreenPass')
  pdf.setCreationDate(ticket.createdAt)
  pdf.setModificationDate(ticket.createdAt)
  const page = pdf.addPage([520, 360])
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const red = rgb(.88, .035, .08)
  const ink = rgb(.09, .10, .14)
  const muted = rgb(.35, .37, .43)

  function text(value: string, x: number, y: number, size: number, font: PDFFont, color = ink, width = 270) {
    let line = printable(font, value)
    if (font.widthOfTextAtSize(line, size) > width) {
      const characters = Array.from(line)
      while (characters.length && font.widthOfTextAtSize(characters.join('') + '...', size) > width) characters.pop()
      line = characters.join('') + '...'
    }
    page.drawText(line, {x, y, size, font, color})
  }
  page.drawRectangle({x: 0, y: 286, width: 520, height: 74, color: ink})
  page.drawRectangle({x: 0, y: 282, width: 520, height: 4, color: red})
  text('SCREENPASS', 30, 319, 23, bold, rgb(1, 1, 1))
  text('DEMO CINEMA TICKET', 31, 301, 9, bold, rgb(.84, .85, .89))
  text(ticket.reference, 348, 317, 11, bold, rgb(1, 1, 1), 142)
  text(ticket.movieTitle, 30, 248, 19, bold, ink, 460)

  const details = [
    ['CINEMA', ticket.cinemaName],
    ['SCREEN', ticket.screenName.replace(/^Demo Auditorium \d+$/, 'Demo auditorium')],
    ['SHOWTIME', ticketDate(ticket.startsAt)],
    ['SEATS', ticket.seats.map(seat => seat.label).join(', ')],
    ['DEMO TOTAL', 'INR ' + ticket.total.toLocaleString('en-IN')],
  ]
  details.forEach(([label, value], index) => {
    const y = 217 - index * 33
    text(label, 30, y, 9, bold, muted)
    text(value, 30, y - 16, 11, regular)
  })
  const qr = await pdf.embedPng(await QRCode.toBuffer(verificationUrl, {width: 320, margin: 4}))
  page.drawRectangle({x: 331, y: 82, width: 159, height: 147, borderWidth: 1, borderColor: rgb(.88, .89, .92)})
  page.drawImage(qr, {x: 355, y: 110, width: 111, height: 111})
  text('Scan to verify', 377, 93, 10, bold)
  page.drawLine({start: {x: 30, y: 48}, end: {x: 490, y: 48}, color: rgb(.88, .89, .92), thickness: 1})
  text('Simulation only. No real payment was collected.', 30, 29, 10, regular, muted, 460)
  return Buffer.from(await pdf.save())
}
