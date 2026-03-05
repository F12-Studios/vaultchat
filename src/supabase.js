import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://krgyvclqgaugmzjtllgr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyZ3l2Y2xxZ2F1Z216anRsbGdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2OTc0NjAsImV4cCI6MjA4ODI3MzQ2MH0.qXBGjIHK0Y00dueVB_jy75LsakrONuE2MZRp98-DzPM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);