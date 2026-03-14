export interface MappingEntry {
  id: number;
  rail: string;
  direction: 'TO_CANONICAL' | 'FROM_CANONICAL';
  source_field: string;
  target_field: string;
  transformation: string;
  validation_rule?: string;
  notes?: string;
  is_active: boolean;
  created_at: string;
}
