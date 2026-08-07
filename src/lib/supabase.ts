import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://gyzfvicorzizfeiuzzan.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_-us-2L4apPmjQFkYCc0CfQ_XqMWDDhQ'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
