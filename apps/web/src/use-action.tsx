import { type FormEvent, useState } from 'react'
import { userMessage } from './user-error'

export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(userMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const submit = (action: () => Promise<void>) => (event: FormEvent) => {
    event.preventDefault()
    void run(action)
  }
  return { busy, error, run, submit }
}

export function ActionError({ error, id }: { error: string; id?: string }) {
  return (
    error && (
      <p id={id} role="alert" className="mt-4 text-danger">
        {error}
      </p>
    )
  )
}
