import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Modal } from './Modal'

interface SetPinDialogProps {
  open: boolean
  onClose: () => void
}

/** Managers/admins set their own approval PIN (4-6 digits). */
export function SetPinDialog({ open, onClose }: SetPinDialogProps) {
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (open) {
      setPin('')
      setConfirm('')
      setError(null)
      setDone(false)
      setBusy(false)
    }
  }, [open])

  const save = async () => {
    if (!supabase || busy) return
    if (!/^[0-9]{4,6}$/.test(pin)) {
      setError('PIN must be 4-6 digits')
      return
    }
    if (pin !== confirm) {
      setError('PINs do not match')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('set_manager_pin', { pin })
    setBusy(false)
    if (error) setError(error.message)
    else setDone(true)
  }

  return (
    <Modal open={open} onClose={onClose} title="My manager PIN" width="min(380px, 94vw)">
      <div className="flex flex-col gap-3 p-5">
        {done ? (
          <>
            <div className="rounded-btn bg-success/15 px-3 py-3 text-center text-success">
              PIN saved. Staff can now request your approval at the till.
            </div>
            <button className="tap rounded-btn bg-primary py-3 font-semibold text-white hover:bg-primary-2" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Staff enter this PIN when a manager-only action needs your approval
              at their terminal. 4-6 digits.
            </p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="New PIN"
              className="rounded-btn border border-line bg-panel-2 px-3 py-3 text-center text-lg tracking-[0.5em] outline-none focus:border-primary"
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
              placeholder="Confirm PIN"
              className="rounded-btn border border-line bg-panel-2 px-3 py-3 text-center text-lg tracking-[0.5em] outline-none focus:border-primary"
            />
            {error && (
              <div className="rounded-btn bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>
            )}
            <div className="flex gap-3">
              <button className="tap flex-1 rounded-btn bg-panel-2 py-3 font-semibold text-muted hover:bg-panel-3" onClick={onClose}>
                Cancel
              </button>
              <button
                disabled={busy}
                onClick={() => void save()}
                className="tap flex-1 rounded-btn bg-primary py-3 font-semibold text-white hover:bg-primary-2 disabled:opacity-40"
              >
                {busy ? 'Saving…' : 'Save PIN'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
