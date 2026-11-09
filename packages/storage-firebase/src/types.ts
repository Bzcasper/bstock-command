export interface FirebaseConfig {
  projectId?: string;
  storageBucket?: string;
  credentialsPath?: string;
  serviceAccountJson?: string;
  databaseId?: string;
  enabled?: boolean;
  localCacheDir?: string;
}

export interface StorageSyncReport {
  listingsSynced: number;
  watchlistSynced: number;
  decisionsSynced: number;
  dbBackedUp: boolean;
  dbRestored: boolean;
  snapshotUploaded: boolean;
  listingsUrl?: string;
  statusUrl?: string;
  mode?: "cloud" | "local-fallback";
  errors: string[];
}

export interface FirebaseStatus {
  enabled: boolean;
  initialized: boolean;
  projectId: string | null;
  storageBucket: string | null;
  firestoreAvailable: boolean;
  storageAvailable: boolean;
  authMethod: string;
  mode?: "cloud" | "local-fallback";
  localCacheDir?: string;
  cachedImagesCount?: number;
}
