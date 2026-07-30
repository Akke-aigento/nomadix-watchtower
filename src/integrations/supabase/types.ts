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
      proposals: {
        Row: {
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
          checks: Json
          created_at: string
          enabled: boolean
          form_smoke_url: string | null
          frequency: string
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
          checks?: Json
          created_at?: string
          enabled?: boolean
          form_smoke_url?: string | null
          frequency?: string
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
          checks?: Json
          created_at?: string
          enabled?: boolean
          form_smoke_url?: string | null
          frequency?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
