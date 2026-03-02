export interface RailAck {
  rail_tx_id?: string;
  status: 'ACCEPTED' | 'REJECTED' | 'ERROR';
  error?: {
    code: string;
    message: string;
  };
  raw_response?: Record<string, unknown>;
}
