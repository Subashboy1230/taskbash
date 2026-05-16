// Root route — there's no homepage; the whole app is the digest at /today.
// Redirect anyone landing on `/` straight there.
import { redirect } from 'next/navigation'

export default function HomePage() {
  redirect('/today')
}
