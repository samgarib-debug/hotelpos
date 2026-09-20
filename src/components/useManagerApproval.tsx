import { useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/authContext'
import { can, type Permission } from '../lib/permissions'
import { PinDialog } from './PinDialog'

interface Pending {
  label: string
  run: () => void
}

/** One-line manager-override integration for gated till actions:
 *
 *    const approval = useManagerApproval()
 *    ...
 *    onClick={() => approval.request('discount', 'Apply discount', doIt)}
 *    ...
 *    {approval.dialog}
 *
 *  Managers/admins run the action immediately; staff get the PIN pad and the
 *  action runs once a manager PIN is verified server-side. */
export function useManagerApproval() {
  const { role } = useAuth()
  const [pending, setPending] = useState<Pending | null>(null)
  const [approvedBy, setApprovedBy] = useState<string | null>(null)

  const request = (perm: Permission, label: string, run: () => void) => {
    if (can(role, perm)) {
      run()
      return
    }
    setPending({ label, run })
  }

  const dialog: ReactNode = (
    <>
      <PinDialog
        open={!!pending}
        action={pending?.label ?? ''}
        onClose={() => setPending(null)}
        onApproved={(manager) => {
          const p = pending
          setPending(null)
          setApprovedBy(manager)
          setTimeout(() => setApprovedBy(null), 3000)
          p?.run()
        }}
      />
      {approvedBy && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-btn bg-success/90 px-4 py-2 text-sm font-semibold text-white shadow-lg">
          Approved by {approvedBy}
        </div>
      )}
    </>
  )

  return { request, dialog, locked: (perm: Permission) => !can(role, perm) }
}
