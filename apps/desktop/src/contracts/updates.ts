export type UpdateStatus =
  | 'unsupported' // dev, Linux or unsigned build: no updater
  | 'idle' // supported, not checked yet
  | 'checking'
  | 'current' // checked, already on the latest
  | 'downloading'
  | 'ready' // downloaded, restart installs it
  | 'error';

export type UpdateState = {
  version: string;
  status: UpdateStatus;
  checkedAt?: number;
};

export type UpdatesApi = {
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
};
