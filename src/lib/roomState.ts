import type { Room } from '../types'
import { todayISO } from '../data/seed'

export interface RoomVisual {
  colorVar: string // css var reference
  label: string // short state code, e.g. "OCC", "VC", "VD"
  status: string // human label
  checkoutDue: boolean
}

/** Combine FO / HK / AVAIL into a single button color + label (SambaPOS-style). */
export function roomVisual(room: Room): RoomVisual {
  if (room.avail === 'OOO') {
    return {
      colorVar: 'var(--color-room-ooo)',
      label: 'OOO',
      status: 'Out of Order',
      checkoutDue: false,
    }
  }
  if (room.fo === 'OCCUPIED') {
    const due = !!room.checkoutDate && room.checkoutDate <= todayISO()
    return {
      colorVar: due ? 'var(--color-room-checkout)' : 'var(--color-room-occupied)',
      label: 'OCC',
      status: due ? 'Checkout Due' : 'Occupied',
      checkoutDue: due,
    }
  }
  // vacant
  if (room.hk === 'DIRTY') {
    return {
      colorVar: 'var(--color-room-dirty)',
      label: 'VD',
      status: 'Vacant · Dirty',
      checkoutDue: false,
    }
  }
  return {
    colorVar: 'var(--color-room-vacant)',
    label: 'VC',
    status: room.hk === 'INSPECTED' ? 'Vacant · Inspected' : 'Vacant · Clean',
    checkoutDue: false,
  }
}
