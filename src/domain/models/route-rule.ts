export interface RouteRule {
  id: number;
  rule_name: string;
  condition_field: string;
  condition_value: string;
  destination_rail: string;
  priority: number;
  is_active: boolean;
  description?: string;
  created_at: string;
}
