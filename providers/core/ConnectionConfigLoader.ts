import fs from 'fs';
import path from 'path';
import type { ConnectionProfile } from '../profiles/ProviderProfile.js';
import { ConnectionRegistry } from './ConnectionRegistry.js';
import { config } from '../../config/index.js';

export interface UserConnectionsConfigFile {
  defaultConnection?: string;
  connections?: Record<string, Partial<ConnectionProfile>>;
}

export class ConnectionConfigLoader {
  static loadFromFile(filePath?: string): number {
    const targetPath = filePath || path.join(config.dataDir, 'connections.json');

    if (!fs.existsSync(targetPath)) {
      return 0;
    }

    try {
      const raw = fs.readFileSync(targetPath, 'utf8');
      const parsed = JSON.parse(raw) as UserConnectionsConfigFile;
      let loadedCount = 0;

      if (parsed.connections && typeof parsed.connections === 'object') {
        for (const [id, item] of Object.entries(parsed.connections)) {
          if (!item.protocolId) {
            continue;
          }
          const profile: ConnectionProfile = {
            id,
            providerId: item.providerId || id,
            protocolId: item.protocolId,
            baseURL: item.baseURL,
            apiKeyEnv: item.apiKeyEnv,
            staticApiKey: item.staticApiKey,
            defaultModelId: item.defaultModelId,
            headers: item.headers,
            capabilityOverrides: item.capabilityOverrides,
            allowedHosts: item.allowedHosts,
            isLocalAllowed: item.isLocalAllowed,
            supportedProtocols: item.supportedProtocols,
          };
          ConnectionRegistry.register(profile);
          loadedCount++;
        }
      }

      if (parsed.defaultConnection && ConnectionRegistry.get(parsed.defaultConnection)) {
        ConnectionRegistry.setDefault(parsed.defaultConnection);
      }

      return loadedCount;
    } catch {
      return 0;
    }
  }
}
