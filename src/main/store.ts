import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppPreferences, StoredTokens } from '../shared/types';

type StoreShape = {
  tokenPayload?: string;
  preferences: AppPreferences;
};

const defaultPreferences: AppPreferences = {
  selectedSkinId: 'minimal',
  alwaysOnTop: false,
  bounds: {
    width: 320,
    height: 120
  }
};

export class AppStore {
  private readonly filePath: string;
  private data: StoreShape = { preferences: defaultPreferences };

  constructor(
    userDataPath: string,
    private readonly secureStorage: {
      isEncryptionAvailable(): boolean;
      encryptString(value: string): Buffer;
      decryptString(encrypted: Buffer): string;
    }
  ) {
    this.filePath = join(userDataPath, 'skindeck-store.json');
  }

  load(): void {
    if (!existsSync(this.filePath)) {
      this.save();
      return;
    }

    const raw = readFileSync(this.filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    const savedBounds = parsed.preferences?.bounds;

    this.data = {
      tokenPayload: parsed.tokenPayload,
      preferences: {
        ...defaultPreferences,
        ...parsed.preferences,
        bounds: savedBounds
          ? {
              width: savedBounds.width ?? defaultPreferences.bounds!.width,
              height: savedBounds.height ?? defaultPreferences.bounds!.height,
              x: savedBounds.x,
              y: savedBounds.y
            }
          : defaultPreferences.bounds
      }
    };
  }

  getTokens(): StoredTokens | null {
    if (!this.data.tokenPayload) return null;

    try {
      const decoded = this.secureStorage.isEncryptionAvailable()
        ? this.secureStorage.decryptString(Buffer.from(this.data.tokenPayload, 'base64'))
        : Buffer.from(this.data.tokenPayload, 'base64').toString('utf8');
      return JSON.parse(decoded) as StoredTokens;
    } catch {
      return null;
    }
  }

  setTokens(tokens: StoredTokens): void {
    const serialized = JSON.stringify(tokens);
    const payload = this.secureStorage.isEncryptionAvailable()
      ? this.secureStorage.encryptString(serialized).toString('base64')
      : Buffer.from(serialized, 'utf8').toString('base64');
    this.data.tokenPayload = payload;
    this.save();
  }

  clearTokens(): void {
    delete this.data.tokenPayload;
    this.save();
  }

  getPreferences(): AppPreferences {
    return this.data.preferences;
  }

  setPreferences(next: Partial<AppPreferences>): AppPreferences {
    this.data.preferences = {
      ...this.data.preferences,
      ...next,
      bounds: next.bounds ? { ...this.data.preferences.bounds, ...next.bounds } : this.data.preferences.bounds
    };
    this.save();
    return this.data.preferences;
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}
