import { useEffect, useRef } from 'react'
import { Input } from './input'

export function OtpInput({
  value,
  onChange,
  invalid = false,
  describedBy,
}: {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  describedBy?: string
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  // A rejected code is cleared by the parent; put the cursor back on the first box.
  useEffect(() => {
    if (invalid) refs.current[0]?.focus()
  }, [invalid])
  const slots = value.padEnd(6, ' ').slice(0, 6).split('')
  const keys = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
  return (
    <fieldset aria-label="Code" className="flex gap-2">
      {keys.map((key, index) => (
        <Input
          key={key}
          ref={(element) => {
            refs.current[index] = element
          }}
          aria-label={`Code digit ${index + 1}`}
          height="otp"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={6}
          required
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? describedBy : undefined}
          value={(slots[index] ?? '').trim()}
          className="min-w-0 flex-1 text-center text-title"
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, '').slice(0, 6 - index)
            const next = [...slots]
            if (!digits) next[index] = ' '
            else
              for (let offset = 0; offset < digits.length; offset++)
                next[index + offset] = digits.charAt(offset)
            onChange(next.join('').trimEnd())
            if (digits) refs.current[Math.min(index + digits.length, 5)]?.focus()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !(slots[index] ?? '').trim() && index > 0)
              refs.current[index - 1]?.focus()
            if (event.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus()
            if (event.key === 'ArrowRight' && index < 5) refs.current[index + 1]?.focus()
          }}
        />
      ))}
    </fieldset>
  )
}
