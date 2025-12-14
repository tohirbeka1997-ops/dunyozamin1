/**
 * Supabase Edge Function: Reset Database
 * 
 * SECURITY: This function requires admin authentication and uses service_role key
 * to truncate all tables in the public schema.
 * 
 * IMPORTANT: This function should ONLY be called from authenticated admin users
 * and should be protected by proper RLS or function-level security.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ResetRequest {
  userId: string;
  confirmText?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with anon key for user verification
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Missing Supabase configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user is authenticated
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user is admin
    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || profile.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Forbidden: Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: ResetRequest = await req.json();
    
    // Optional: Require confirmation text
    if (body.confirmText && body.confirmText !== 'DELETE') {
      return new Response(
        JSON.stringify({ error: 'Invalid confirmation text' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create service role client for database operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Get all tables in public schema
    const { data: tables, error: tablesError } = await supabaseAdmin.rpc(
      'get_public_tables'
    ).catch(async () => {
      // Fallback: Use direct SQL query if RPC doesn't exist
      const { data, error } = await supabaseAdmin
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public')
        .eq('table_type', 'BASE TABLE');
      
      return { data: data?.map(t => ({ name: t.table_name })), error };
    });

    if (tablesError) {
      // If we can't get table list, use hardcoded list of known tables
      const knownTables = [
        'sales_returns',
        'sales_return_items',
        'payments',
        'order_items',
        'orders',
        'inventory_movements',
        'purchase_order_items',
        'purchase_orders',
        'expenses',
        'expense_categories',
        'customer_payments',
        'customers',
        'products',
        'categories',
        'supplier_payments',
        'supplier_ledger_entries',
        'suppliers',
        'shifts',
        'employee_sessions',
        'employee_activity_logs',
        'profiles',
      ];

      // Truncate each table
      for (const tableName of knownTables) {
        try {
          await supabaseAdmin.rpc('exec_sql', {
            sql: `TRUNCATE TABLE ${tableName} RESTART IDENTITY CASCADE;`,
          }).catch(async () => {
            // Fallback: Direct SQL execution
            await supabaseAdmin.from(tableName).delete().neq('id', '00000000-0000-0000-0000-000000000000');
          });
        } catch (error) {
          console.error(`Error truncating ${tableName}:`, error);
          // Continue with other tables
        }
      }
    } else {
      // Truncate each table found
      for (const table of tables || []) {
        const tableName = typeof table === 'string' ? table : table.name;
        if (!tableName) continue;

        try {
          // Skip system tables
          if (tableName.startsWith('_') || tableName === 'schema_migrations') {
            continue;
          }

          await supabaseAdmin.rpc('exec_sql', {
            sql: `TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE;`,
          }).catch(async () => {
            // Fallback: Delete all rows (slower but works)
            const { error: deleteError } = await supabaseAdmin
              .from(tableName)
              .delete()
              .neq('id', '00000000-0000-0000-0000-000000000000');
            
            if (deleteError) {
              console.error(`Error deleting from ${tableName}:`, deleteError);
            }
          });
        } catch (error) {
          console.error(`Error truncating ${tableName}:`, error);
          // Continue with other tables
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Database reset completed',
        resetBy: user.id,
        resetAt: new Date().toISOString(),
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('Error in reset-db function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});


