import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initializeApp, getApps, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
export class FirebaseStorageService {
    app = null;
    firestore = null;
    storage = null;
    config;
    authMethod = "none";
    localCacheDir;
    localImagesDir;
    constructor(config = {}) {
        this.config = {
            projectId: config.projectId ?? process.env.FIREBASE_PROJECT_ID ?? process.env.GCP_PROJECT_ID,
            storageBucket: config.storageBucket ?? process.env.FIREBASE_STORAGE_BUCKET,
            credentialsPath: config.credentialsPath ?? process.env.GOOGLE_APPLICATION_CREDENTIALS,
            serviceAccountJson: config.serviceAccountJson ?? process.env.FIREBASE_SERVICE_ACCOUNT,
            databaseId: config.databaseId ?? process.env.FIREBASE_DATABASE_ID ?? "(default)",
            enabled: config.enabled ?? process.env.FIREBASE_ENABLED !== "0",
            localCacheDir: config.localCacheDir ?? path.resolve(process.cwd(), ".data/storage-cache"),
        };
        this.localCacheDir = this.config.localCacheDir;
        this.localImagesDir = path.join(this.localCacheDir, "images");
        try {
            fs.mkdirSync(this.localImagesDir, { recursive: true });
        }
        catch { }
    }
    init() {
        if (!this.config.enabled)
            return false;
        if (this.app)
            return true;
        // Detect project ID if not explicitly specified
        if (!this.config.projectId) {
            const adcPath = path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json");
            if (fs.existsSync(adcPath)) {
                try {
                    const raw = JSON.parse(fs.readFileSync(adcPath, "utf8"));
                    if (raw.quota_project_id)
                        this.config.projectId = raw.quota_project_id;
                }
                catch { }
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
            }
            else if (this.config.serviceAccountJson) {
                const creds = typeof this.config.serviceAccountJson === "string"
                    ? JSON.parse(this.config.serviceAccountJson)
                    : this.config.serviceAccountJson;
                this.app = initializeApp({
                    credential: cert(creds),
                    projectId: this.config.projectId,
                    storageBucket: this.config.storageBucket,
                });
                this.authMethod = "service-account-json";
            }
            else if (this.config.credentialsPath && fs.existsSync(this.config.credentialsPath)) {
                const creds = JSON.parse(fs.readFileSync(this.config.credentialsPath, "utf8"));
                this.app = initializeApp({
                    credential: cert(creds),
                    projectId: this.config.projectId,
                    storageBucket: this.config.storageBucket,
                });
                this.authMethod = "credentials-file";
            }
            else {
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
        }
        catch (err) {
            console.warn("[bstock-command] Firebase initialization notice:", err.message);
            this.app = null;
            this.firestore = null;
            this.storage = null;
            this.authMethod = "local-fallback: " + err.message;
            return false;
        }
    }
    isInitialized() {
        return this.app !== null;
    }
    getLocalImagesDir() {
        return this.localImagesDir;
    }
    getStatus() {
        if (!this.app && this.config.enabled) {
            this.init();
        }
        let cachedCount = 0;
        try {
            if (fs.existsSync(this.localImagesDir)) {
                cachedCount = fs.readdirSync(this.localImagesDir).length;
            }
        }
        catch { }
        return {
            enabled: Boolean(this.config.enabled),
            initialized: this.isInitialized(),
            projectId: this.config.projectId ?? null,
            storageBucket: this.config.storageBucket ?? null,
            firestoreAvailable: Boolean(this.firestore),
            storageAvailable: Boolean(this.storage),
            authMethod: this.authMethod,
            mode: this.isInitialized() ? "cloud" : "local-fallback",
            localCacheDir: this.localCacheDir,
            cachedImagesCount: cachedCount,
        };
    }
    getFirestore() {
        if (!this.firestore)
            this.init();
        return this.firestore;
    }
    getStorage() {
        if (!this.storage)
            this.init();
        return this.storage;
    }
    getBucket(bucketName) {
        const storage = this.getStorage();
        if (!storage)
            return null;
        const name = bucketName ?? this.config.storageBucket;
        return name ? storage.bucket(name) : storage.bucket();
    }
    // ------------------------------------------------ Cloud Storage File Ops
    async uploadFile(localPath, destination, contentType) {
        const bucket = this.getBucket();
        if (bucket) {
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
            }
            catch (err) {
                // Fall back to local storage cache below
            }
        }
        // Local file cache fallback
        try {
            const localDest = path.join(this.localCacheDir, destination);
            fs.mkdirSync(path.dirname(localDest), { recursive: true });
            fs.copyFileSync(localPath, localDest);
            return {
                success: true,
                path: destination,
                publicUrl: `/api/storage/files/${destination}`,
            };
        }
        catch (err) {
            return { success: false, path: destination, error: err.message };
        }
    }
    async downloadFile(remotePath, localDestination) {
        const bucket = this.getBucket();
        if (bucket) {
            try {
                const file = bucket.file(remotePath);
                const [exists] = await file.exists();
                if (exists) {
                    fs.mkdirSync(path.dirname(localDestination), { recursive: true });
                    await file.download({ destination: localDestination });
                    return { success: true };
                }
            }
            catch {
                // Check local fallback
            }
        }
        // Local file cache fallback
        const localCached = path.join(this.localCacheDir, remotePath);
        if (fs.existsSync(localCached)) {
            try {
                fs.mkdirSync(path.dirname(localDestination), { recursive: true });
                fs.copyFileSync(localCached, localDestination);
                return { success: true };
            }
            catch (err) {
                return { success: false, error: err.message };
            }
        }
        return { success: false, error: "Remote and local file not found: " + remotePath };
    }
    async uploadJson(data, destination) {
        const json = JSON.stringify(data, null, 2);
        const bucket = this.getBucket();
        if (bucket) {
            try {
                const file = bucket.file(destination);
                await file.save(json, {
                    contentType: "application/json",
                    resumable: false,
                });
                return {
                    success: true,
                    path: destination,
                    publicUrl: `https://storage.googleapis.com/${bucket.name}/${destination}`,
                };
            }
            catch {
                // Fall through to local fallback
            }
        }
        // Local fallback
        try {
            const localDest = path.join(this.localCacheDir, destination);
            fs.mkdirSync(path.dirname(localDest), { recursive: true });
            fs.writeFileSync(localDest, json, "utf8");
            return {
                success: true,
                path: destination,
                publicUrl: `/api/storage/files/${destination}`,
            };
        }
        catch (err) {
            return { success: false, path: destination, error: err.message };
        }
    }
    async downloadJson(remotePath) {
        const bucket = this.getBucket();
        if (bucket) {
            try {
                const file = bucket.file(remotePath);
                const [exists] = await file.exists();
                if (exists) {
                    const [buffer] = await file.download();
                    return JSON.parse(buffer.toString("utf8"));
                }
            }
            catch { }
        }
        const localCached = path.join(this.localCacheDir, remotePath);
        if (fs.existsSync(localCached)) {
            try {
                return JSON.parse(fs.readFileSync(localCached, "utf8"));
            }
            catch {
                return null;
            }
        }
        return null;
    }
    // ------------------------------------------------ Image Caching
    async cacheImage(remoteUrl, lotId) {
        if (!remoteUrl || !remoteUrl.startsWith("http")) {
            return { success: false, localFilename: "", url: remoteUrl };
        }
        const ext = path.extname(new URL(remoteUrl).pathname) || ".jpg";
        const filename = `${lotId}-${Buffer.from(remoteUrl).toString("base64url").slice(-12)}${ext}`;
        const localTarget = path.join(this.localImagesDir, filename);
        if (fs.existsSync(localTarget)) {
            return { success: true, localFilename: filename, url: `/api/images/${filename}` };
        }
        try {
            const res = await fetch(remoteUrl, { signal: AbortSignal.timeout(10_000) });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const arrayBuffer = await res.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            fs.writeFileSync(localTarget, buffer);
            // Attempt background upload to bucket if bucket is ready
            const bucket = this.getBucket();
            if (bucket) {
                bucket.file(`images/${filename}`).save(buffer, { resumable: false }).catch(() => { });
            }
            return { success: true, localFilename: filename, url: `/api/images/${filename}` };
        }
        catch {
            // Return remote URL if download fails
            return { success: false, localFilename: "", url: remoteUrl };
        }
    }
    // ------------------------------------------------ Database Backups
    async backupDatabase(dbPath) {
        if (!fs.existsSync(dbPath)) {
            return { success: false, remotePath: "", mode: "none", error: "Local DB does not exist: " + dbPath };
        }
        const destination = "backups/bstock.db";
        const res = await this.uploadFile(dbPath, destination, "application/x-sqlite3");
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        await this.uploadFile(dbPath, `backups/bstock-${timestamp}.db`, "application/x-sqlite3").catch(() => { });
        return {
            success: res.success,
            remotePath: destination,
            mode: res.publicUrl?.startsWith("http") ? "cloud" : "local-cache",
            error: res.error,
        };
    }
    async restoreDatabase(dbPath) {
        const destination = "backups/bstock.db";
        const res = await this.downloadFile(destination, dbPath);
        return { success: res.success, restored: res.success, error: res.error };
    }
    // ------------------------------------------------ Firestore Document Sync
    async syncListingsToFirestore(listings) {
        const db = this.getFirestore();
        if (db) {
            try {
                const batchSize = 400;
                let count = 0;
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
                return { count, mode: "cloud" };
            }
            catch (err) {
                // Fall back to local file snapshot below
            }
        }
        // Local file snapshot fallback
        const res = await this.uploadJson(listings, "snapshots/listings.json");
        return { count: listings.length, mode: "local-cache", error: res.error };
    }
    async syncWatchlistToFirestore(items) {
        const db = this.getFirestore();
        if (db) {
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
                return { count: items.length, mode: "cloud" };
            }
            catch {
                // Fall through to local fallback
            }
        }
        await this.uploadJson(items, "snapshots/watchlist.json");
        return { count: items.length, mode: "local-cache" };
    }
    async pullWatchlistFromFirestore() {
        const db = this.getFirestore();
        if (db) {
            try {
                const snap = await db.collection("watchlist").get();
                return snap.docs.map((d) => {
                    const data = d.data();
                    return {
                        listing_id: d.id,
                        note: data.note ?? null,
                        added_at: data.added_at ?? new Date().toISOString(),
                    };
                });
            }
            catch { }
        }
        const local = await this.downloadJson("snapshots/watchlist.json");
        return local ?? [];
    }
    async syncDecisionsToFirestore(decisions) {
        const db = this.getFirestore();
        if (db) {
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
                return { count: decisions.length, mode: "cloud" };
            }
            catch { }
        }
        await this.uploadJson(decisions, "snapshots/decisions.json");
        return { count: decisions.length, mode: "local-cache" };
    }
    async pullDecisionsFromFirestore() {
        const db = this.getFirestore();
        if (db) {
            try {
                const snap = await db.collection("decisions").get();
                return snap.docs.map((d) => {
                    const data = d.data();
                    return {
                        listing_id: d.id,
                        recovery_pct: data.recovery_pct ?? null,
                        target_roi: data.target_roi ?? null,
                        target_max_cents: data.target_max_cents ?? null,
                        notes: data.notes ?? null,
                        updated_at: data.updated_at ?? new Date().toISOString(),
                    };
                });
            }
            catch { }
        }
        const local = await this.downloadJson("snapshots/decisions.json");
        return local ?? [];
    }
}
