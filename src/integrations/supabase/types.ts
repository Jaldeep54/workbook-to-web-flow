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
      deliveries: {
        Row: {
          created_at: string
          delivery_date: string | null
          id: string
          labelling_cost: number
          month: string | null
          order_id: string
          packaging_cost: number
          production_cost: number
          profit: number
          shop_id: string
          status: string | null
          total_fixed_cost: number
          total_qty: number
          total_sales: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivery_date?: string | null
          id?: string
          labelling_cost?: number
          month?: string | null
          order_id: string
          packaging_cost?: number
          production_cost?: number
          profit?: number
          shop_id: string
          status?: string | null
          total_fixed_cost?: number
          total_qty?: number
          total_sales?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivery_date?: string | null
          id?: string
          labelling_cost?: number
          month?: string | null
          order_id?: string
          packaging_cost?: number
          production_cost?: number
          profit?: number
          shop_id?: string
          status?: string | null
          total_fixed_cost?: number
          total_qty?: number
          total_sales?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "label_stock_view"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "deliveries_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_label_stock_summary"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "deliveries_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_sku_opportunity"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "deliveries_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_lines: {
        Row: {
          delivery_id: string
          id: string
          product_id: string
          qty: number
        }
        Insert: {
          delivery_id: string
          id?: string
          product_id: string
          qty?: number
        }
        Update: {
          delivery_id?: string
          id?: string
          product_id?: string
          qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_lines_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      investments: {
        Row: {
          amount: number
          created_at: string
          done_by: string
          id: string
          investment_date: string
        }
        Insert: {
          amount?: number
          created_at?: string
          done_by: string
          id?: string
          investment_date: string
        }
        Update: {
          amount?: number
          created_at?: string
          done_by?: string
          id?: string
          investment_date?: string
        }
        Relationships: []
      }
      label_order_lines: {
        Row: {
          id: string
          label_order_id: string
          label_product_id: string
          products: number
          sheets: number
        }
        Insert: {
          id?: string
          label_order_id: string
          label_product_id: string
          products?: number
          sheets?: number
        }
        Update: {
          id?: string
          label_order_id?: string
          label_product_id?: string
          products?: number
          sheets?: number
        }
        Relationships: [
          {
            foreignKeyName: "label_order_lines_label_order_id_fkey"
            columns: ["label_order_id"]
            isOneToOne: false
            referencedRelation: "label_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_order_lines_label_product_id_fkey"
            columns: ["label_product_id"]
            isOneToOne: false
            referencedRelation: "label_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_order_lines_label_product_id_fkey"
            columns: ["label_product_id"]
            isOneToOne: false
            referencedRelation: "label_stock_view"
            referencedColumns: ["label_product_id"]
          },
        ]
      }
      label_orders: {
        Row: {
          created_at: string
          id: string
          month: string | null
          order_date: string | null
          order_no: number
          shop_id: string
          total_labels: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          month?: string | null
          order_date?: string | null
          order_no: number
          shop_id: string
          total_labels?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          month?: string | null
          order_date?: string | null
          order_no?: number
          shop_id?: string
          total_labels?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "label_orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "label_stock_view"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "label_orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_label_stock_summary"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "label_orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_sku_opportunity"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "label_orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      label_products: {
        Row: {
          id: string
          key: string
          labels_per_sheet: number
          low_stock_threshold: number
          name: string
          product_id: string
          sheet_cost: number
          short_name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          id?: string
          key: string
          labels_per_sheet: number
          low_stock_threshold?: number
          name: string
          product_id: string
          sheet_cost: number
          short_name: string
          sort_order: number
          updated_at?: string
        }
        Update: {
          id?: string
          key?: string
          labels_per_sheet?: number
          low_stock_threshold?: number
          name?: string
          product_id?: string
          sheet_cost?: number
          short_name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "label_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_lines: {
        Row: {
          id: string
          order_id: string
          product_id: string
          qty: number
        }
        Insert: {
          id?: string
          order_id: string
          product_id: string
          qty?: number
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string
          qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          delivery_date: string | null
          id: string
          month: string | null
          notes: string | null
          order_date: string | null
          order_no: number
          shop_id: string
          status: string
          total_qty: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivery_date?: string | null
          id?: string
          month?: string | null
          notes?: string | null
          order_date?: string | null
          order_no: number
          shop_id: string
          status?: string
          total_qty?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivery_date?: string | null
          id?: string
          month?: string | null
          notes?: string | null
          order_date?: string | null
          order_no?: number
          shop_id?: string
          status?: string
          total_qty?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "label_stock_view"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_label_stock_summary"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_sku_opportunity"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount: number
          created_at: string
          done_by: string
          id: string
          payout_date: string
        }
        Insert: {
          amount?: number
          created_at?: string
          done_by: string
          id?: string
          payout_date: string
        }
        Update: {
          amount?: number
          created_at?: string
          done_by?: string
          id?: string
          payout_date?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          collected_by: string | null
          collected_date: string | null
          created_at: string
          id: string
          month: string | null
          order_id: string
          payment_date: string | null
          shop_id: string
          status: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          collected_by?: string | null
          collected_date?: string | null
          created_at?: string
          id?: string
          month?: string | null
          order_id: string
          payment_date?: string | null
          shop_id: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          collected_by?: string | null
          collected_date?: string | null
          created_at?: string
          id?: string
          month?: string | null
          order_id?: string
          payment_date?: string | null
          shop_id?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "label_stock_view"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "payments_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_label_stock_summary"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "payments_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_sku_opportunity"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "payments_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          id: string
          is_active: boolean
          key: string
          label_cost_per_unit: number
          name: string
          packaging_cost: number
          production_cost: number
          selling_price: number
          short_name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          id?: string
          is_active?: boolean
          key: string
          label_cost_per_unit?: number
          name: string
          packaging_cost?: number
          production_cost?: number
          selling_price?: number
          short_name: string
          sort_order: number
          updated_at?: string
        }
        Update: {
          id?: string
          is_active?: boolean
          key?: string
          label_cost_per_unit?: number
          name?: string
          packaging_cost?: number
          production_cost?: number
          selling_price?: number
          short_name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      shop_areas: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      shop_products: {
        Row: {
          created_at: string
          id: string
          product_id: string
          shop_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          shop_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_products_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "label_stock_view"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "shop_products_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_label_stock_summary"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "shop_products_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_sku_opportunity"
            referencedColumns: ["shop_id"]
          },
          {
            foreignKeyName: "shop_products_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          address: string | null
          area_id: string | null
          bill_name: string | null
          code: string
          created_at: string
          design_type: number
          folder_name: string | null
          handled_by: string | null
          id: string
          image_path: string | null
          is_active: boolean
          joined_on: string | null
          label_name: string | null
          latitude: number | null
          longitude: number | null
          mobile: string | null
          shop_name: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          area_id?: string | null
          bill_name?: string | null
          code: string
          created_at?: string
          design_type?: number
          folder_name?: string | null
          handled_by?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          joined_on?: string | null
          label_name?: string | null
          latitude?: number | null
          longitude?: number | null
          mobile?: string | null
          shop_name: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          area_id?: string | null
          bill_name?: string | null
          code?: string
          created_at?: string
          design_type?: number
          folder_name?: string | null
          handled_by?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          joined_on?: string | null
          label_name?: string | null
          latitude?: number | null
          longitude?: number | null
          mobile?: string | null
          shop_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shops_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "shop_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      variable_costs: {
        Row: {
          amount: number
          cost_date: string
          cost_type: string
          created_at: string
          id: string
          month: string | null
          note: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          cost_date: string
          cost_type?: string
          created_at?: string
          id?: string
          month?: string | null
          note?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          cost_date?: string
          cost_type?: string
          created_at?: string
          id?: string
          month?: string | null
          note?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      label_stock_view: {
        Row: {
          design_type: number | null
          is_low: boolean | null
          label_product_id: string | null
          label_product_key: string | null
          label_product_name: string | null
          low_stock_threshold: number | null
          shop_id: string | null
          shop_name: string | null
          shop_sells_product: boolean | null
          sort_order: number | null
          stock: number | null
        }
        Relationships: []
      }
      shop_label_stock_summary: {
        Row: {
          design_type: number | null
          has_label_order: boolean | null
          include_in_dashboard: boolean | null
          low_stock_count: number | null
          shop_id: string | null
          shop_name: string | null
        }
        Relationships: []
      }
      shop_sku_opportunity: {
        Row: {
          active_months: number | null
          active_products: string[] | null
          address: string | null
          avg_monthly_sales: number | null
          inactive_products: string[] | null
          is_active: boolean | null
          label_name: string | null
          shop_id: string | null
          shop_name: string | null
          total_sales: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      available_months: {
        Args: never
        Returns: {
          month: string
        }[]
      }
      cash_position_summary: { Args: never; Returns: Json }
      dashboard_summary: { Args: { p_month: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      next_shop_code: { Args: never; Returns: number }
      order_qty_by_product: {
        Args: never
        Returns: {
          product_id: string
          product_key: string
          short_name: string
          sort_order: number
          total_qty: number
        }[]
      }
      set_order_delivered: {
        Args: { p_delivery_date: string; p_order_id: string }
        Returns: string
      }
      upsert_shop_area: {
        Args: { p_name: string }
        Returns: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
      }
      set_order_status: {
        Args: { p_delivery_date?: string; p_order_id: string; p_status: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "staff"
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
    Enums: {
      app_role: ["admin", "staff"],
    },
  },
} as const
