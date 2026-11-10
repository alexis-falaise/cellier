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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      catalog_products: {
        Row: {
          brand: string | null
          category_key: string | null
          category_rule: string | null
          category_tags: string[]
          created_at: string
          gtin: string
          image_url: string | null
          name: string
          net_quantity: number | null
          net_unit: string | null
          pack_count: number | null
          popularity: number
          price_cents: number | null
          price_chain: string | null
          price_observed_on: string | null
          quantity_label: string | null
          search_text: string | null
          source: string
          source_modified_at: string | null
          store_tags: string[]
          updated_at: string
        }
        Insert: {
          brand?: string | null
          category_key?: string | null
          category_rule?: string | null
          category_tags?: string[]
          created_at?: string
          gtin: string
          image_url?: string | null
          name: string
          net_quantity?: number | null
          net_unit?: string | null
          pack_count?: number | null
          popularity?: number
          price_cents?: number | null
          price_chain?: string | null
          price_observed_on?: string | null
          quantity_label?: string | null
          search_text?: string | null
          source: string
          source_modified_at?: string | null
          store_tags?: string[]
          updated_at?: string
        }
        Update: {
          brand?: string | null
          category_key?: string | null
          category_rule?: string | null
          category_tags?: string[]
          created_at?: string
          gtin?: string
          image_url?: string | null
          name?: string
          net_quantity?: number | null
          net_unit?: string | null
          pack_count?: number | null
          popularity?: number
          price_cents?: number | null
          price_chain?: string | null
          price_observed_on?: string | null
          quantity_label?: string | null
          search_text?: string | null
          source?: string
          source_modified_at?: string | null
          store_tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_products_category_key_fkey"
            columns: ["category_key"]
            isOneToOne: false
            referencedRelation: "category_templates"
            referencedColumns: ["key"]
          },
        ]
      }
      categories: {
        Row: {
          color: string | null
          created_at: string
          deleted_at: string | null
          field_clock: Json
          household_id: string
          icon: string | null
          id: string
          name: string
          name_key: string | null
          sort_order: number
          template_key: string | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          field_clock?: Json
          household_id: string
          icon?: string | null
          id: string
          name: string
          name_key?: string | null
          sort_order?: number
          template_key?: string | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          field_clock?: Json
          household_id?: string
          icon?: string | null
          id?: string
          name?: string
          name_key?: string | null
          sort_order?: number
          template_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_template_key_fkey"
            columns: ["template_key"]
            isOneToOne: false
            referencedRelation: "category_templates"
            referencedColumns: ["key"]
          },
        ]
      }
      category_templates: {
        Row: {
          key: string
          name: string
          sort_order: number
        }
        Insert: {
          key: string
          name: string
          sort_order: number
        }
        Update: {
          key?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      field_overwrites: {
        Row: {
          actor_id: string | null
          created_at: string
          entity: string
          field: string
          household_id: string
          id: string
          new_hlc: string
          new_value: Json | null
          old_hlc: string
          old_value: Json | null
          row_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity: string
          field: string
          household_id: string
          id?: string
          new_hlc: string
          new_value?: Json | null
          old_hlc: string
          old_value?: Json | null
          row_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity?: string
          field?: string
          household_id?: string
          id?: string
          new_hlc?: string
          new_value?: Json | null
          old_hlc?: string
          old_value?: Json | null
          row_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_overwrites_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      grocery_entries: {
        Row: {
          added_by: string | null
          checked_at: string | null
          checked_by: string | null
          created_at: string
          deleted_at: string | null
          dismissed_at: string | null
          field_clock: Json
          household_id: string
          id: string
          label: string | null
          product_id: string | null
          quantity: number | null
          updated_at: string
        }
        Insert: {
          added_by?: string | null
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          deleted_at?: string | null
          dismissed_at?: string | null
          field_clock?: Json
          household_id: string
          id: string
          label?: string | null
          product_id?: string | null
          quantity?: number | null
          updated_at?: string
        }
        Update: {
          added_by?: string | null
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          deleted_at?: string | null
          dismissed_at?: string | null
          field_clock?: Json
          household_id?: string
          id?: string
          label?: string | null
          product_id?: string | null
          quantity?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grocery_entries_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grocery_entries_household_id_product_id_fkey"
            columns: ["household_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      household_forecasts: {
        Row: {
          cadence_days: number | null
          computed_at: string
          confidence: string
          household_id: string
          next_trip_on: string | null
        }
        Insert: {
          cadence_days?: number | null
          computed_at?: string
          confidence: string
          household_id: string
          next_trip_on?: string | null
        }
        Update: {
          cadence_days?: number | null
          computed_at?: string
          confidence?: string
          household_id?: string
          next_trip_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "household_forecasts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: true
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      household_invites: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          household_id: string
          id: string
          max_uses: number
          revoked_at: string | null
          token_hash: string
          uses: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at: string
          household_id: string
          id?: string
          max_uses?: number
          revoked_at?: string | null
          token_hash: string
          uses?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          household_id?: string
          id?: string
          max_uses?: number
          revoked_at?: string | null
          token_hash?: string
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "household_invites_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      household_members: {
        Row: {
          avatar_url: string | null
          display_name: string
          household_id: string
          joined_at: string
          notify_digest: boolean
          notify_running_low: boolean
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          display_name?: string
          household_id: string
          joined_at?: string
          notify_digest?: boolean
          notify_running_low?: boolean
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          display_name?: string
          household_id?: string
          joined_at?: string
          notify_digest?: boolean
          notify_running_low?: boolean
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          field_clock: Json
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          field_clock?: Json
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          field_clock?: Json
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      pantries: {
        Row: {
          color: string | null
          created_at: string
          deleted_at: string | null
          field_clock: Json
          household_id: string
          icon: string | null
          id: string
          name: string
          name_key: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          field_clock?: Json
          household_id: string
          icon?: string | null
          id: string
          name: string
          name_key?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          field_clock?: Json
          household_id?: string
          icon?: string | null
          id?: string
          name?: string
          name_key?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pantries_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      product_forecasts: {
        Row: {
          computed_at: string
          confidence: string
          days_left: number | null
          household_id: string
          product_id: string
          rate_per_day: number
          rate_shape: number
          run_out_at: string | null
          usual_quantity: number | null
        }
        Insert: {
          computed_at?: string
          confidence: string
          days_left?: number | null
          household_id: string
          product_id: string
          rate_per_day: number
          rate_shape: number
          run_out_at?: string | null
          usual_quantity?: number | null
        }
        Update: {
          computed_at?: string
          confidence?: string
          days_left?: number | null
          household_id?: string
          product_id?: string
          rate_per_day?: number
          rate_shape?: number
          run_out_at?: string | null
          usual_quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_forecasts_household_id_product_id_fkey"
            columns: ["household_id", "product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      products: {
        Row: {
          brand: string | null
          catalog_gtin: string | null
          category_id: string | null
          created_at: string
          deleted_at: string | null
          field_clock: Json
          gtin: string | null
          household_id: string
          id: string
          image_url: string | null
          low_alert: boolean
          min_quantity: number | null
          name: string
          name_key: string | null
          net_quantity: number | null
          net_unit: string | null
          pack_count: number | null
          price_cents: number | null
          price_source: string | null
          updated_at: string
          usual_quantity: number | null
        }
        Insert: {
          brand?: string | null
          catalog_gtin?: string | null
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          field_clock?: Json
          gtin?: string | null
          household_id: string
          id: string
          image_url?: string | null
          low_alert?: boolean
          min_quantity?: number | null
          name: string
          name_key?: string | null
          net_quantity?: number | null
          net_unit?: string | null
          pack_count?: number | null
          price_cents?: number | null
          price_source?: string | null
          updated_at?: string
          usual_quantity?: number | null
        }
        Update: {
          brand?: string | null
          catalog_gtin?: string | null
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          field_clock?: Json
          gtin?: string | null
          household_id?: string
          id?: string
          image_url?: string | null
          low_alert?: boolean
          min_quantity?: number | null
          name?: string
          name_key?: string | null
          net_quantity?: number | null
          net_unit?: string | null
          pack_count?: number | null
          price_cents?: number | null
          price_source?: string | null
          updated_at?: string
          usual_quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_catalog_gtin_fkey"
            columns: ["catalog_gtin"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["gtin"]
          },
          {
            foreignKeyName: "products_household_id_category_id_fkey"
            columns: ["household_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "products_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failure_count: number
          id: string
          last_seen_at: string
          last_success_at: string | null
          notify_digest: boolean
          notify_running_low: boolean
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failure_count?: number
          id?: string
          last_seen_at?: string
          last_success_at?: string | null
          notify_digest?: boolean
          notify_running_low?: boolean
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failure_count?: number
          id?: string
          last_seen_at?: string
          last_success_at?: string | null
          notify_digest?: boolean
          notify_running_low?: boolean
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      stock: {
        Row: {
          household_id: string
          pantry_id: string
          product_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          household_id: string
          pantry_id: string
          product_id: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          household_id?: string
          pantry_id?: string
          product_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_household_id_pantry_id_fkey"
            columns: ["household_id", "pantry_id"]
            isOneToOne: false
            referencedRelation: "pantries"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "stock_household_id_product_id_fkey"
            columns: ["household_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          actor_id: string | null
          applied_delta: number
          clamped: boolean | null
          client_at: string | null
          counted: number | null
          created_at: string
          device_id: string | null
          household_id: string
          id: string
          kind: string
          pantry_id: string
          product_id: string
          quantity_after: number
          requested_delta: number
          reverts_id: string | null
          seq: number
          source: string | null
          transfer_id: string | null
        }
        Insert: {
          actor_id?: string | null
          applied_delta: number
          clamped?: boolean | null
          client_at?: string | null
          counted?: number | null
          created_at?: string
          device_id?: string | null
          household_id: string
          id: string
          kind: string
          pantry_id: string
          product_id: string
          quantity_after: number
          requested_delta: number
          reverts_id?: string | null
          seq?: never
          source?: string | null
          transfer_id?: string | null
        }
        Update: {
          actor_id?: string | null
          applied_delta?: number
          clamped?: boolean | null
          client_at?: string | null
          counted?: number | null
          created_at?: string
          device_id?: string | null
          household_id?: string
          id?: string
          kind?: string
          pantry_id?: string
          product_id?: string
          quantity_after?: number
          requested_delta?: number
          reverts_id?: string | null
          seq?: never
          source?: string | null
          transfer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_household_id_pantry_id_fkey"
            columns: ["household_id", "pantry_id"]
            isOneToOne: false
            referencedRelation: "pantries"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "stock_movements_household_id_product_id_fkey"
            columns: ["household_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "stock_movements_reverts_id_fkey"
            columns: ["reverts_id"]
            isOneToOne: false
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invite: { Args: { p_code: string }; Returns: Json }
      apply_mutations: { Args: { p_request: Json }; Returns: Json }
      catalog_lookup_gate: {
        Args: { p_gtin: string; p_user: string }
        Returns: Json
      }
      catalog_record_miss: { Args: { p_gtin: string }; Returns: undefined }
      catalog_upsert: { Args: { p_row: Json }; Returns: Json }
      create_household: {
        Args: {
          p_household_id: string
          p_name: string
          p_pantry_id: string
          p_pantry_name: string
        }
        Returns: Json
      }
      create_invite: { Args: { p_household_id: string }; Returns: Json }
      delete_account: { Args: never; Returns: undefined }
      delete_household: { Args: { p_household_id: string }; Returns: undefined }
      leave_household: { Args: { p_household_id: string }; Returns: undefined }
      notification_claim: { Args: { p_limit?: number }; Returns: Json }
      notification_complete: { Args: { p_report: Json }; Returns: undefined }
      peek_invite: { Args: { p_code: string }; Returns: Json }
      pull_changes: {
        Args: { p_household: string; p_limit?: number; p_since: number }
        Returns: Json
      }
      register_push_subscription: {
        Args: {
          p_auth: string
          p_endpoint: string
          p_p256dh: string
          p_user_agent?: string
        }
        Returns: string
      }
      remove_member: {
        Args: { p_household_id: string; p_user_id: string }
        Returns: undefined
      }
      revoke_invite: { Args: { p_invite_id: string }; Returns: undefined }
      search_catalog: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          brand: string | null
          category_key: string | null
          category_rule: string | null
          category_tags: string[]
          created_at: string
          gtin: string
          image_url: string | null
          name: string
          net_quantity: number | null
          net_unit: string | null
          pack_count: number | null
          popularity: number
          price_cents: number | null
          price_chain: string | null
          price_observed_on: string | null
          quantity_label: string | null
          search_text: string | null
          source: string
          source_modified_at: string | null
          store_tags: string[]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "catalog_products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      transfer_ownership: {
        Args: { p_household_id: string; p_user_id: string }
        Returns: undefined
      }
      verify_internal_secret: { Args: { p_secret: string }; Returns: boolean }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
