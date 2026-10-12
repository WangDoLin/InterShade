import type { ModelCapabilities } from '../catalog/ModelDescriptor.js';

export interface ConnectionProfile {
  id: string;
  providerId: string;
  protocolId: string;
  baseURL?: string;
  apiKeyEnv?: string;
  staticApiKey?: string;
  defaultModelId?: string;
  headers?: Record<string, string>;
  capabilityOverrides?: Partial<ModelCapabilities>;
  allowedHosts?: string[];
  isLocalAllowed?: boolean;
  supportedProtocols?: string[];
}

export interface ProviderProfile {
  id: string;
  displayName: string;
  supportedProtocols: string[];
  defaultBaseURL?: string;
  defaultModelId: string;
  apiKeyEnv?: string;
}
