import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initializeApp, getApps, cert, applicationDefault, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";
import type { FirebaseConfig, FirebaseStatus } from "./types.ts";

export class FirebaseStorageService {
  private app: App | null = null;
  private firestore: Firestore | null = null;
  private storage: Storage | null = null;
  private config: FirebaseConfig;
  private authMethod = "none";

  constructor(config: FirebaseConfig = {}) {
    this.config = {
      projectId: config.projectId ?? process.env.FIREBASE_PROJECT_ID ?? process.env.GCP_PROJECT_ID,
      storageBucket: config.storageBucket ?? process.env.FIREBASE_STORAGE_BUCKET,
      credentialsPath: config.credentialsPath ?? process.env.GOOGLE_APPLICATION_CREDENTIALS,
      serviceAccountJson: config.serviceAccountJson ?? process.env.FIREBASE_SERVICE_ACCOUNT,
      databaseId: config.databaseId ?? process.env.FIREBASE_DATABASE_ID ?? "(default)",
      enabled: config.enabled ?? process.env.FIREBASE_ENABLED !== "0",
    };
  }

  init(): boolean {
    if (!this.config.enabled) return false;
    if (this.app) return true;

    // Detect project ID if not explicitly specified
    if (!this.config.projectId) {
      const adcPath = path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json");
      if (fs.existsSync(adcPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(adcPath, "utf8"));
          if (raw.quota_project_id) this.config.projectId = raw.quota_project_id;
        } catch {}
      }
    }
    if (!this.config.projectId) {
      this.config.projectId = "colab-plugin";
    }

    if (!this.config.storageBucket && this.config.projectId) {
      this.config.storageBucket = `${this.config.projectId}.appspot.com`;
    }

    try {
      const existingApps = getApps();
      if (existingApps.length > 0 && existingApps[0]) {
        this.app = existingApps[0];
        this.authMethod = "existing-app";
      } else if (this.config.serviceAccountJson) {
        const creds = typeof this.config.serviceAccountJson === "string"
          ? JSON.parse(this.config.serviceAccountJson)
          : this.config.serviceAccountJson;
        this.app = initializeApp({
          credential: cert(creds),
          projectId: this.config.projectId,
          storageBucket: this.config.storageBucket,
        });
        this.authMethod = "service-account-json";
      } else if (this.config.credentialsPath && fs.existsSync(this.config.credentialsPath)) {
        const creds = JSON.parse(fs.readFileSync(this.config.credentialsPath, "utf8"));
        this.app = initializeApp({
          credential: cert(creds),
          projectId: this.config.projectId,
          storageBucket: this.config.storageBucket,
        });
        this.authMethod = "credentials-file";
      } else {
        // Fall back to Application Default Credentials
        this.app = initializeApp({
          credential: applicationDefault(),
          projectId: this.config.projectId,
          storageBucket: this.config.storageBucket,
        });
        this.authMethod = "application-default-credentials";
      }

      this.firestore = this.config.databaseId
        ? getFirestore(this.app, this.config.databaseId)
        : getFirestore(this.app);
      this.storage = getStorage(this.app);
      return true;
    } catch (err) {
      console.warn("[bstock-command] Firebase initialization warning:", (err as Error).message);
      this.app = null;
      this.firestore = null;
      this.storage = null;
      this.authMethod = "error: " + (err as Error).message;
      return false;
    }
  }

  isInitialized(): boolean {
    return this.app !== null;
  }

  getStatus(): FirebaseStatus {
    if (!this.app && this.config.enabled) {
      this.init();
    }
    return {
      enabled: Boolean(this.config.enabled),
      initialized: this.isInitialized(),
      projectId: this.config.projectId ?? null,
      storageBucket: this.config.storageBucket ?? null,
      firestoreAvailable: Boolean(this.firestore),
      storageAvailable: Boolean(this.storage),
      authMethod: this.authMethod,
    };
  }

  getFirestore(): Firestore | null {
    if (!this.firestore) this.init();
    return this.firestore;
  }

  getStorage(): Storage | null {
    if (!this.storage) this.init();
    return this.storage;
  }

  getBucket(bucketName?: string) {
    const storage = this.getStorage();
    if (!storage) return null;
    const name = bucketName ?? this.config.storageBucket;
    return name ? storage.bucket(name) : storage.bucket();
  }

  // ------------------------------------------------ Cloud Storage File Ops
  async uploadFile(localPath: string, destination: string, contentType?: string): Promise<{ success: boolean; path: string; publicUrl?: string; error?: string }> {
    const bucket = this.getBucket();
    if (!bucket) return { success: false, path: destination, error: "Firebase storage bucket not available" };
    try {
      await bucket.upload(localPath, {
        destination,
        metadata: contentType ? { contentType } : undefined,
      });
      return {
        success: true,
        path: destination,
        publicUrl: `https://storage.googleapis.com/${bucket.name}/${destination}`,
      };
    } catch (err) {
      return { success: false, path: destination, error: (err as Error).message };
    }
  }

  async downloadFile(remotePath: string, localDestination: string): Promise<{ success: boolean; error?: string }> {
    const bucket = this.getBucket();
    if (!bucket) return { success: false, error: "Firebase storage bucket not available" };
    try {
      const file = bucket.file(remotePath);
      const [exists] = await file.exists();
      if (!exists) return { success: false, error: "Remote file does not exist: " + remotePath };
      fs.mkdirSync(path.dirname(localDestination), { recursive: true });
      await file.download({ destination: localDestination });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async uploadJson(data: unknown, destination: string): Promise<{ success: boolean; path: string; publicUrl?: string; error?: string }> {
    const bucket = this.getBucket();
    if (!bucket) return { success: false, path: destination, error: "Firebase storage bucket not available" };
    try {
      const file = bucket.file(destination);
      const json = JSON.stringify(data, null, 2);
      await file.save(json, {
        contentType: "application/json",
        resumable: false,
      });
      return {
        success: true,
        path: destination,
        publicUrl: `https://storage.googleapis.com/${bucket.name}/${destination}`,
      };
    } catch (err) {
      return { success: false, path: destination, error: (err as Error).message };
    }
  }

  async downloadJson<T = unknown>(remotePath: string): Promise<T | null> {
    const bucket = this.getBucket();
    if (!bucket) return null;
    try {
      const file = bucket.file(remotePath);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [buffer] = await file.download();
      return JSON.parse(buffer.toString("utf8")) as T;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------ Database Backups
  async backupDatabase(dbPath: string): Promise<{ success: boolean; remotePath: string; error?: string }> {
    if (!fs.existsSync(dbPath)) {
      return { success: false, remotePath: "", error: "Local DB does not exist: " + dbPath };
    }
    const destination = "backups/bstock.db";
    const res = await this.uploadFile(dbPath, destination, "application/x-sqlite3");
    if (!res.success) return { success: false, remotePath: destination, error: res.error };

    // Also write a timestamped backup for auditability
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await this.uploadFile(dbPath, `backups/bstock-${timestamp}.db`, "application/x-sqlite3").catch(() => {});
    return { success: true, remotePath: destination };
  }

  async restoreDatabase(dbPath: string): Promise<{ success: boolean; restored: boolean; error?: string }> {
    const bucket = this.getBucket();
    if (!bucket) return { success: false, restored: false, error: "Storage bucket not available" };
    const destination = "backups/bstock.db";
    const file = bucket.file(destination);
    try {
      const [exists] = await file.exists();
      if (!exists) {
        return { success: true, restored: false }; // Normal if no remote backup has been uploaded yet
      }
      const res = await this.downloadFile(destination, dbPath);
      return { success: res.success, restored: res.success, error: res.error };
    } catch (err) {
      return { success: false, restored: false, error: (err as Error).message };
    }
  }

  // ------------------------------------------------ Firestore Document Sync
  async syncListingsToFirestore(listings: Array<Record<string, unknown>>): Promise<{ count: number; error?: string }> {
    const db = this.getFirestore();
    if (!db) return { count: 0, error: "Firestore not initialized" };

    let count = 0;
    try {
      // Write in batches of 400 (Firestore max is 500)
      const batchSize = 400;
      for (let i = 0; i < listings.length; i += batchSize) {
        const slice = listings.slice(i, i + batchSize);
        const batch = db.batch();
        for (const item of slice) {
          const id = String(item.listing_id || item.listingId || `lot-${count}`);
          const ref = db.collection("listings").doc(id);
          batch.set(ref, {
            ...item,
            _syncedAt: new Date().toISOString(),
          }, { merge: true });
        }
        await batch.commit();
        count += slice.length;
      }
      return { count };
    } catch (err) {
      return { count, error: (err as Error).message };
    }
  }

  async syncWatchlistToFirestore(items: Array<{ listing_id: string; note?: string | null; added_at?: string }>): Promise<{ count: number; error?: string }> {
    const db = this.getFirestore();
    if (!db) return { count: 0, error: "Firestore not initialized" };
    try {
      const batch = db.batch();
      for (const item of items) {
        const ref = db.collection("watchlist").doc(item.listing_id);
        batch.set(ref, {
          listing_id: item.listing_id,
          note: item.note ?? null,
          added_at: item.added_at ?? new Date().toISOString(),
        }, { merge: true });
      }
      await batch.commit();
      return { count: items.length };
    } catch (err) {
      return { count: 0, error: (err as Error).message };
    }
  }

  async pullWatchlistFromFirestore(): Promise<Array<{ listing_id: string; note: string | null; added_at: string }>> {
    const db = this.getFirestore();
    if (!db) return [];
    try {
      const snap = await db.collection("watchlist").get();
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          listing_id: d.id,
          note: (data.note as string) ?? null,
          added_at: (data.added_at as string) ?? new Date().toISOString(),
        };
      });
    } catch {
      return [];
    }
  }

  async syncDecisionsToFirestore(decisions: Array<{ listing_id: string; recovery_pct?: number | null; target_roi?: number | null; target_max_cents?: number | null; notes?: string | null; updated_at?: string }>): Promise<{ count: number; error?: string }> {
    const db = this.getFirestore();
    if (!db) return { count: 0, error: "Firestore not initialized" };
    try {
      const batch = db.batch();
      for (const d of decisions) {
        const ref = db.collection("decisions").doc(d.listing_id);
        batch.set(ref, {
          listing_id: d.listing_id,
          recovery_pct: d.recovery_pct ?? null,
          target_roi: d.target_roi ?? null,
          target_max_cents: d.target_max_cents ?? null,
          notes: d.notes ?? null,
          updated_at: d.updated_at ?? new Date().toISOString(),
        }, { merge: true });
      }
      await batch.commit();
      return { count: decisions.length };
    } catch (err) {
      return { count: 0, error: (err as Error).message };
    }
  }

  async pullDecisionsFromFirestore(): Promise<Array<{ listing_id: string; recovery_pct: number | null; target_roi: number | null; target_max_cents: number | null; notes: string | null; updated_at: string }>> {
    const db = this.getFirestore();
    if (!db) return [];
    try {
      const snap = await db.collection("decisions").get();
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          listing_id: d.id,
          recovery_pct: (data.recovery_pct as number) ?? null,
          target_roi: (data.target_roi as number) ?? null,
          target_max_cents: (data.target_max_cents as number) ?? null,
          notes: (data.notes as string) ?? null,
          updated_at: (data.updated_at as string) ?? new Date().toISOString(),
        };
      });
    } catch {
      return [];
    }
  }
}
