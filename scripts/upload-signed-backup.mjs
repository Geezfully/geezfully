import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const [backupFile, metadataFile, backupPath, backupToken, metadataPath, metadataToken] = process.argv.slice(2);
const required = {
  BACKUP_SUPABASE_URL: process.env.BACKUP_SUPABASE_URL,
  BACKUP_SUPABASE_PUBLISHABLE_KEY: process.env.BACKUP_SUPABASE_PUBLISHABLE_KEY,
  BACKUP_BUCKET: process.env.BACKUP_BUCKET,
};

for (const [name, value] of Object.entries(required)) {
  if (!value) throw new Error(`Missing ${name}`);
}
if (![backupFile, metadataFile, backupPath, backupToken, metadataPath, metadataToken].every(Boolean)) {
  throw new Error("Signed upload arguments are incomplete");
}

const supabase = createClient(required.BACKUP_SUPABASE_URL, required.BACKUP_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const storage = supabase.storage.from(required.BACKUP_BUCKET);

const backupBytes = await readFile(backupFile);
const metadataBytes = await readFile(metadataFile);
const backupUpload = await storage.uploadToSignedUrl(backupPath, backupToken, backupBytes, {
  contentType: "application/octet-stream",
});
if (backupUpload.error) throw backupUpload.error;

const metadataUpload = await storage.uploadToSignedUrl(metadataPath, metadataToken, metadataBytes, {
  contentType: "application/json",
});
if (metadataUpload.error) throw metadataUpload.error;

console.log(`Uploaded ${backupBytes.byteLength} encrypted bytes and backup metadata.`);
