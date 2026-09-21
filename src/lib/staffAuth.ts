/** Staff accounts have no real email: the auth identity is a synthetic
 *  `<username>@hotelpos.invalid` address (.invalid is RFC-reserved and can
 *  never receive mail). Must match the create-staff edge function. */
export const STAFF_DOMAIN = 'hotelpos.invalid'

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/

export const USERNAME_HINT =
  'Lowercase letters, digits, dots, dashes or underscores (max 32), starting with a letter or digit'

export const MIN_PASSWORD = 8
