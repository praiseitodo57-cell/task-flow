import { createClient } from "@supabase/supabase-js";
import dotenv from 'dotenv'

dotenv.config()
// First, read the environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SERVER_ROLE;

export const supabase = createClient(supabaseUrl, supabaseKey);