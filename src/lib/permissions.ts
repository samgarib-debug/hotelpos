export type Role = 'staff' | 'manager' | 'admin'

export type Permission =
  | 'discount' // apply ticket discounts
  | 'void_submitted' // void a line after it was sent to the kitchen
  | 'comp' // settle a ticket as complimentary
  | 'cancel_booking' // cancel a reservation/booking
  | 'reports' // view the Reports section
  | 'reset_data' // reset demo data
  | 'set_pin' // set own manager approval PIN
  | 'close_day' // run the End of Day close
  | 'add_staff' // view the staff list & create new staff accounts
  | 'manage_staff' // assign roles, deactivate accounts

const MANAGER: Permission[] = [
  'discount',
  'void_submitted',
  'comp',
  'cancel_booking',
  'reports',
  'reset_data',
  'set_pin',
  'close_day',
  'add_staff',
]

const GRANTS: Record<Role, Permission[]> = {
  staff: [],
  manager: MANAGER,
  admin: [...MANAGER, 'manage_staff'],
}

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role]?.includes(permission) ?? false
}
