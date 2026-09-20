import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Modal } from './Modal'

interface PinDialogProps {
  open: boolean
  action: string // human label, e.g. "Apply discount"
  onClose: () => void
  onApproved: (managerName: string) => void
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

/** Manager-PIN approval pad. Verifies server-side via verify_manager_pin(). */
export function PinDialog({ open, action, onClose, onApproved }: PinDialogProps) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setPin('')
      setError(null)
      setBusy(false)
    }
  }, [open])

  const press = (d: string) => {
    if (pin.length < 6) setPin(pin + d)
    setError(null)
  }

  const verify = async () => {
    if (busy || pin.length < 4) return
    if (!supabase) {
      setError('Manager PIN needs the online backend.')
      return
    }
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.rpc('verify_manager_pin', {
      pin,
      action_name: action,
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      setPin('')
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    if (!row) {
      setError('Wrong PIN')
      setPin('')
      return
    }
    onApproved(row.approved_by_name ?? 'Manager')
  }

  return (
    <Modal open={open} onClose={onClose} title="Manager approval" width="min(360px, 94vw)">
      <div className="flex flex-col gap-4 p-5">
        <div className="rounded-btn bg-panel-2 px-3 py-2 text-center text-sm">
          <span className="text-muted">Action: </span>
          <span className="font-semibold">{action}</span>
        </div>

        {/* masked PIN display */}
        <div className="flex h-12 items-center justify-center gap-3 rounded-btn bg-panel-2">
          {pin.length === 0 ? (
            <span className="text-sm text-muted">Enter manager PIN</span>
          ) : (
            Array.from({ length: pin.length }).map((_, i) => (
              <span key={i} className="h-3 w-3 rounded-full bg-fg" />
            ))
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((k) => (
            <button
              key={k}
              onClick={() => press(k)}
              className="tap rounded-btn bg-panel-2 py-4 text-2xl font-semibold hover:bg-panel-3"
            >
              {k}
            </button>
          ))}
          <button
            onClick={() => {
              setPin('')
              setError(null)
            }}
            className="tap rounded-btn bg-panel-2 py-4 text-sm font-semibold text-danger hover:bg-panel-3"
          >
            Clear
          </button>
          <button
            onClick={() => press('0')}
            className="tap rounded-btn bg-panel-2 py-4 text-2xl font-semibold hover:bg-panel-3"
          >
            0
          </button>
          <button
            onClick={() => setPin(pin.slice(0, -1))}
            className="tap rounded-btn bg-panel-2 py-4 text-xl font-semibold text-warn hover:bg-panel-3"
          >
            ⌫
          </button>
        </div>

        {error && (
          <div className="rounded-btn bg-danger/15 px-3 py-2 text-center text-sm text-danger">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button className="tap flex-1 rounded-btn bg-panel-2 py-3 font-semibold text-muted hover:bg-panel-3" onClick={onClose}>
            Cancel
          </button>
          <button
            disabled={pin.length < 4 || busy}
            onClick={() => void verify()}
            className="tap flex-1 rounded-btn bg-primary py-3 font-semibold text-white hover:bg-primary-2 disabled:opacity-40"
          >
            {busy ? 'Checking…' : 'Approve'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
