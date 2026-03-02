import type { Rail } from '../../config/constants.js';

export interface RouteRule {
  id: string;
  name: string;
  priority: number;
  origin_rail?: Rail | string;
  destination_rail: Rail | string;
  currency_match?: string;
  amount_min?: number;
  amount_max?: number;
  country_match?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}
