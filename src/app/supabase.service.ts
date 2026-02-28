import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vedgimjkagzysrthfqvk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlZGdpbWprYWd6eXNydGhmcXZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMTIyMzgsImV4cCI6MjA4Nzc4ODIzOH0.MMLN4AuWVBGEvIA_OtrN3Hsnll2QglOVV2rXyP1fEPg';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  get client() {
    return this.supabase;
  }
}
