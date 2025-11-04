export interface ProgressLogExtra {
  level?: 'info' | 'success' | 'warning' | 'error';
  detail?: string;
  [key: string]: unknown;
}

export type ProgressLogger = (
  jobId: string | undefined,
  stage: string,
  message: string,
  extra?: ProgressLogExtra
) => void;

export interface TransferRuntimeOptions {
  jobId?: string;
  context?: string;
  logStage?: ProgressLogger;
}
