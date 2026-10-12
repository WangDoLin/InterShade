import type { ConnectionProfile } from '../profiles/ProviderProfile.js';
import type { ModelDescriptor } from '../catalog/ModelDescriptor.js';
import type { LanguageModel } from '../core/BaseModel.js';

export interface ProtocolAdapter {
  readonly protocolId: string;
  createModel(connection: ConnectionProfile, descriptor: ModelDescriptor): LanguageModel;
}
