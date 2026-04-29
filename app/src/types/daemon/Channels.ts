export interface ChannelOption {
  name: string;
  label: string;
}

export interface ConfiguredChannel extends ChannelOption {
  secret_count: number;
}

export interface ChannelsResponse {
  pod_id: string;
  available: ChannelOption[];
  configured: ConfiguredChannel[];
}
