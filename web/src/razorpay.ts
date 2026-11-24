type CheckoutResult = {razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string}
type CheckoutOptions = {
  key: string
  order_id: string
  amount: number
  currency: 'INR'
  name: string
  description: string
  theme: {color: string}
  handler: (result: CheckoutResult) => void
  modal: {ondismiss: () => void}
}
type Checkout = {open: () => void}

declare global {
  interface Window {
    Razorpay?: new (options: CheckoutOptions) => Checkout
  }
}

let loading: Promise<NonNullable<Window['Razorpay']>> | undefined
export async function loadCheckout() {
  if (window.Razorpay) return window.Razorpay
  loading ??= new Promise<NonNullable<Window['Razorpay']>>((resolve, reject) => {
    const script = document.createElement('script')
    const timer = window.setTimeout(fail, 8000)
    function fail() {
      window.clearTimeout(timer)
      script.remove()
      reject(new Error('The payment window could not load. Check your internet connection and try again.'))
    }
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => {
      if (!window.Razorpay) {fail(); return}
      window.clearTimeout(timer)
      resolve(window.Razorpay)
    }
    script.onerror = fail
    document.head.appendChild(script)
  }).catch(error => {loading = undefined; throw error})
  return loading
}
