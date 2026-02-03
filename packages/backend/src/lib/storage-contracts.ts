export const DOWNLOAD_EXPIRES_SECONDS = 10 * 60;

export interface StorageTicket {
  url: string;
  expiresAt: string;
}

// The worker needs storage credentials, not authentication or email settings.
export interface StorageConfig {
  AWS_REGION: string;
  S3_BUCKET?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ENDPOINT?: string;
}
