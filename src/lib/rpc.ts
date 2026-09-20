import { supabase, supabaseEnabled } from './supabase'
import { applyServerRows, syncFlush } from './sync'

export { supabaseEnabled }

/** Call a server-priced settlement RPC. Flushes pending pushes first (the
 *  RPC reads server state, e.g. settle_ticket prices the ticket's lines),
 *  then merges the rows the RPC wrote into the local store. */
export async function settlementRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data?: any; error?: string }> {
  if (!supabase) return { error: 'Backend not available' }
  await syncFlush()
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return { error: error.message }
  applyServerRows(data)
  return { data }
}
