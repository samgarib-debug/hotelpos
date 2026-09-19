import { cn } from '../lib/cn'

interface NumpadProps {
  value: string
  onChange: (next: string) => void
  className?: string
}

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', '.']

/** Shared touch numeric keypad (SambaPOS-style). Operates on a string buffer. */
export function Numpad({ value, onChange, className }: NumpadProps) {
  const press = (k: string) => {
    if (k === '.' && value.includes('.')) return
    if (k === '.' && value === '') return onChange('0.')
    onChange(value === '0' && k !== '.' && k !== '00' ? k : value + k)
  }
  const backspace = () => onChange(value.slice(0, -1))
  const clear = () => onChange('')

  return (
    <div className={cn('grid grid-cols-3 gap-2', className)}>
      {KEYS.map((k) => (
        <button
          key={k}
          className="tap rounded-btn bg-panel-2 py-4 text-2xl font-semibold hover:bg-panel-3"
          onClick={() => press(k)}
        >
          {k}
        </button>
      ))}
      <button
        className="tap rounded-btn bg-panel-2 py-4 text-xl font-semibold text-warn hover:bg-panel-3"
        onClick={backspace}
      >
        ⌫
      </button>
      <button
        className="tap col-span-2 rounded-btn bg-panel-2 py-4 text-xl font-semibold text-danger hover:bg-panel-3"
        onClick={clear}
      >
        Clear
      </button>
    </div>
  )
}
