import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://qdqapcrbgbjcsoxnacoa.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkcWFwY3JiZ2JqY3NveG5hY29hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NDI3MDYsImV4cCI6MjA5NzIxODcwNn0.Pzhb4m2Ei2oge-3EAgd8hi1asQJeAkeKWrxIAtStlPE'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)

export type DbProject = {
  id: string
  name: string
  created_at: string
  updated_at: string
}
