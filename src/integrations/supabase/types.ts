export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      agenda_items: {
        Row: {
          id: string
          fingerprint: string
          title: string
          description: string | null
          due_date: string
          kind: string
          severity: string
          integration_key: string | null
          target_id: string | null
          source_url: string | null
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          fingerprint: string
          title: string
          description?: string | null
          due_date: string
          kind?: string
          severity?: string
          integration_key?: string | null
          target_id?: string | null
          source_url?: string | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          fingerprint?: string
          title?: string
          description?: string | null
          due_date?: string
          kind?: string
          severity?: string
          integration_key?: string | null
          target_id?: string | null
          source_url?: string | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      alert_log: {
        Row: {
          check_key: string
          created_at: string
          detail: Json | null
          id: string
          mailed: boolean
          target_id: string
          transition: string
        }
        Insert: {
          check_key: string
          created_at?: string
          detail?: Json | null
          id?: string
          mailed?: boolean
          target_id: string
          transition: string
        }
        Update: {
          check_key?: string
          created_at?: string
          detail?: Json | null
          id?: string
          mailed?: boolean
          target_id?: string
          transition?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_log_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "watch_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_summaries: {
        Row: {
          avg_latency_ms: number | null
          day: string
          fail_count: number
          id: string
          target_id: string
          uptime_pct: number | null
        }
        Insert: {
          avg_latency_ms?: number | null
          day: string
          fail_count?: number
          id?: string
          target_id: string
          uptime_pct?: number | null
        }
        Update: {
          avg_latency_ms?: number | null
          day?: string
          fail_count?: number
          id?: string
          target_id?: string
          uptime_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_summaries_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "watch_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_snapshots: {
        Row: {
          id: string
          lovable_project_id: string
          project_name: string
          taken_at: string
          exec_s_per_day: number | null
          stats_since: string | null
          db_size_mb: number | null
          pg_net_backlog: number | null
          crons: Json
          top_queries: Json
          realtime_tables: string[]
          drivers: string[]
          savings: Json
          source: string
        }
        Insert: {
          id?: string
          lovable_project_id: string
          project_name: string
          taken_at?: string
          exec_s_per_day?: number | null
          stats_since?: string | null
          db_size_mb?: number | null
          pg_net_backlog?: number | null
          crons?: Json
          top_queries?: Json
          realtime_tables?: string[]
          drivers?: string[]
          savings?: Json
          source?: string
        }
        Update: {
          id?: string
          lovable_project_id?: string
          project_name?: string
          taken_at?: string
          exec_s_per_day?: number | null
          stats_since?: string | null
          db_size_mb?: number | null
          pg_net_backlog?: number | null
          crons?: Json
          top_queries?: Json
          realtime_tables?: string[]
          drivers?: string[]
          savings?: Json
          source?: string
        }
        Relationships: []
      }
      findings: {
        Row: {
          id: string
          fingerprint: string
          integration_key: string | null
          kind: string
          title: string
          summary: string
          analysis: string | null
          impact: string
          severity: string
          affected_tenants: number | null
          source_url: string
          source_published: string | null
          effective_date: string | null
          status: string
          bundle: string | null
          detected_by: string
          detected_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          fingerprint: string
          integration_key?: string | null
          kind: string
          title: string
          summary: string
          analysis?: string | null
          impact?: string
          severity?: string
          affected_tenants?: number | null
          source_url: string
          source_published?: string | null
          effective_date?: string | null
          status?: string
          bundle?: string | null
          detected_by?: string
          detected_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          fingerprint?: string
          integration_key?: string | null
          kind?: string
          title?: string
          summary?: string
          analysis?: string | null
          impact?: string
          severity?: string
          affected_tenants?: number | null
          source_url?: string
          source_published?: string | null
          effective_date?: string | null
          status?: string
          bundle?: string | null
          detected_by?: string
          detected_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      integration_usages: {
        Row: {
          id: string
          integration_key: string
          repo: string
          file: string
          version: string
          occurrences: number
          scanned_at: string
          kind: string
        }
        Insert: {
          id?: string
          integration_key: string
          repo: string
          file: string
          version?: string
          occurrences?: number
          scanned_at?: string
          kind?: string
        }
        Update: {
          id?: string
          integration_key?: string
          repo?: string
          file?: string
          version?: string
          occurrences?: number
          scanned_at?: string
          kind?: string
        }
        Relationships: []
      }
      integrations: {
        Row: {
          id: string
          key: string
          name: string
          partner: string
          category: string
          used_version: string | null
          latest_version: string | null
          usage_state: string
          active_tenants: number | null
          last_activity_at: string | null
          risk: string
          risk_note: string | null
          discovered_via: string
          discovered_at: string
          last_seen_at: string
          docs_url: string | null
          changelog_url: string | null
          status_page_url: string | null
          upstream_indicator: string | null
          upstream_description: string | null
          upstream_checked_at: string | null
          radar_checked_at: string | null
          notes: string | null
          pricing_url: string | null
          review_days: number | null
          radar_note: string | null
          touchpoints: Json
        }
        Insert: {
          id?: string
          key: string
          name: string
          partner: string
          category?: string
          used_version?: string | null
          latest_version?: string | null
          usage_state?: string
          active_tenants?: number | null
          last_activity_at?: string | null
          risk?: string
          risk_note?: string | null
          discovered_via?: string
          discovered_at?: string
          last_seen_at?: string
          docs_url?: string | null
          changelog_url?: string | null
          status_page_url?: string | null
          upstream_indicator?: string | null
          upstream_description?: string | null
          upstream_checked_at?: string | null
          radar_checked_at?: string | null
          notes?: string | null
          pricing_url?: string | null
          review_days?: number | null
          radar_note?: string | null
          touchpoints?: Json
        }
        Update: {
          id?: string
          key?: string
          name?: string
          partner?: string
          category?: string
          used_version?: string | null
          latest_version?: string | null
          usage_state?: string
          active_tenants?: number | null
          last_activity_at?: string | null
          risk?: string
          risk_note?: string | null
          discovered_via?: string
          discovered_at?: string
          last_seen_at?: string
          docs_url?: string | null
          changelog_url?: string | null
          status_page_url?: string | null
          upstream_indicator?: string | null
          upstream_description?: string | null
          upstream_checked_at?: string | null
          radar_checked_at?: string | null
          notes?: string | null
          pricing_url?: string | null
          review_days?: number | null
          radar_note?: string | null
          touchpoints?: Json
        }
        Relationships: []
      }
      incident_events: {
        Row: {
          created_at: string
          id: string
          incident_id: string
          kind: string
          message: string
        }
        Insert: {
          created_at?: string
          id?: string
          incident_id: string
          kind: string
          message: string
        }
        Update: {
          created_at?: string
          id?: string
          incident_id?: string
          kind?: string
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_events_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          acknowledged_note: string | null
          acknowledged_until: string | null
          check_key: string
          detail: Json | null
          id: string
          last_reminder_at: string | null
          last_seen_at: string
          notified_at: string | null
          opened_at: string
          resolved_at: string | null
          severity: string
          status: string
          summary: string | null
          target_id: string
          title: string
        }
        Insert: {
          acknowledged_note?: string | null
          acknowledged_until?: string | null
          check_key: string
          detail?: Json | null
          id?: string
          last_reminder_at?: string | null
          last_seen_at?: string
          notified_at?: string | null
          opened_at?: string
          resolved_at?: string | null
          severity: string
          status?: string
          summary?: string | null
          target_id: string
          title: string
        }
        Update: {
          acknowledged_note?: string | null
          acknowledged_until?: string | null
          check_key?: string
          detail?: Json | null
          id?: string
          last_reminder_at?: string | null
          last_seen_at?: string
          notified_at?: string | null
          opened_at?: string
          resolved_at?: string | null
          severity?: string
          status?: string
          summary?: string | null
          target_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "watch_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      watchtower_admins: {
        Row: { created_at: string; user_id: string }
        Insert: { created_at?: string; user_id: string }
        Update: { created_at?: string; user_id?: string }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failure_count: number
          id: string
          last_success_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      proposals: {
        Row: {
          bundle: string | null
          bundle_title: string | null
          bundle_order: number | null
          executed_at: string | null
          fingerprint: string | null
          incident_id: string | null
          result: string | null
          category: string
          created_at: string
          decided_at: string | null
          description: string
          id: string
          proposed_action: string
          source: string
          status: string
          target_id: string | null
          title: string
        }
        Insert: {
          bundle?: string | null
          bundle_title?: string | null
          bundle_order?: number | null
          executed_at?: string | null
          fingerprint?: string | null
          incident_id?: string | null
          result?: string | null
          category: string
          created_at?: string
          decided_at?: string | null
          description: string
          id?: string
          proposed_action: string
          source?: string
          status?: string
          target_id?: string | null
          title: string
        }
        Update: {
          bundle?: string | null
          bundle_title?: string | null
          bundle_order?: number | null
          executed_at?: string | null
          fingerprint?: string | null
          incident_id?: string | null
          result?: string | null
          category?: string
          created_at?: string
          decided_at?: string | null
          description?: string
          id?: string
          proposed_action?: string
          source?: string
          status?: string
          target_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposals_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "watch_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_results: {
        Row: {
          check_key: string
          detail: Json | null
          id: string
          latency_ms: number | null
          measured_at: string
          status: string
          target_id: string
        }
        Insert: {
          check_key: string
          detail?: Json | null
          id?: string
          latency_ms?: number | null
          measured_at?: string
          status: string
          target_id: string
        }
        Update: {
          check_key?: string
          detail?: Json | null
          id?: string
          latency_ms?: number | null
          measured_at?: string
          status?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_results_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "watch_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      watch_targets: {
        Row: {
          sellqo_tenant_id: string | null
          checks: Json
          created_at: string
          enabled: boolean
          form_smoke_url: string | null
          frequency: string
          health_token: string | null
          health_url: string | null
          id: string
          kind: string
          last_scanned_at: string | null
          lovable_project_id: string | null
          name: string
          notes: string | null
          status: string
          url: string
        }
        Insert: {
          sellqo_tenant_id?: string | null
          checks?: Json
          created_at?: string
          enabled?: boolean
          form_smoke_url?: string | null
          frequency?: string
          health_token?: string | null
          health_url?: string | null
          id?: string
          kind: string
          last_scanned_at?: string | null
          lovable_project_id?: string | null
          name: string
          notes?: string | null
          status?: string
          url: string
        }
        Update: {
          sellqo_tenant_id?: string | null
          checks?: Json
          created_at?: string
          enabled?: boolean
          form_smoke_url?: string | null
          frequency?: string
          health_token?: string | null
          health_url?: string | null
          id?: string
          kind?: string
          last_scanned_at?: string | null
          lovable_project_id?: string | null
          name?: string
          notes?: string | null
          status?: string
          url?: string
        }
        Relationships: []
      }
      web_access: {
        Row: {
          domain: string
          reason: string
          integration_key: string | null
          status: string
          requested_at: string
          decided_at: string | null
          synced_at: string | null
        }
        Insert: {
          domain: string
          reason: string
          integration_key?: string | null
          status?: string
          requested_at?: string
          decided_at?: string | null
          synced_at?: string | null
        }
        Update: {
          domain?: string
          reason?: string
          integration_key?: string | null
          status?: string
          requested_at?: string
          decided_at?: string | null
          synced_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      credit_latest: {
        Row: {
          id: string
          lovable_project_id: string
          project_name: string
          taken_at: string
          exec_s_per_day: number | null
          stats_since: string | null
          db_size_mb: number | null
          pg_net_backlog: number | null
          crons: Json
          top_queries: Json
          realtime_tables: string[]
          drivers: string[]
          savings: Json
          source: string
        }
        Relationships: []
      }
      agenda: {
        Row: {
          id: string
          title: string
          description: string | null
          due_date: string
          kind: string
          severity: string
          integration_key: string | null
          target_id: string | null
          source_url: string | null
          status: string
          origin: string
        }
        Relationships: []
      }
      radar_coverage: {
        Row: {
          key: string
          name: string
          partner: string
          usage_state: string
          risk: string
          radar_checked_at: string | null
          radar_note: string | null
          review_days_effective: number
          due: boolean
        }
        Relationships: []
      }
    }
    Functions: {
      get_agenda_token: { Args: never; Returns: string }
      get_cron_secret: { Args: never; Returns: string }
      get_heartbeat_url: { Args: never; Returns: string }
      get_vapid_private_jwk: { Args: never; Returns: string }
      is_watchtower_admin: { Args: never; Returns: boolean }
      wt_ingest_scan: { Args: { scan: Json }; Returns: Json }
      wt_engine_health: { Args: never; Returns: Json }
      wt_latency_hourly: {
        Args: { p_days?: number }
        Returns: { target_id: string; hour: string; p50_ms: number; checks: number; fails: number }[]
      }
      wt_incidents_weekly: {
        Args: { p_weeks?: number }
        Returns: { week: string; grp: string; n: number }[]
      }
      wt_daily_check_status: {
        Args: { p_target: string; p_days?: number }
        Returns: {
          check_key: string
          day: string
          fail: number
          ok: number
          unknown: number
          warn: number
        }[]
      }
      wt_recent_results: {
        Args: { n?: number }
        Returns: {
          check_key: string
          detail: Json
          latency_ms: number
          measured_at: string
          rn: number
          status: string
          target_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
