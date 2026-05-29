import { invoke } from "./runtime";

export interface DowntifySong {
  song_id?: string;
  name?: string;
  artists?: string[];
  album_name?: string;
  duration?: number;
  url?: string;
  [key: string]: unknown;
}

export interface DowntifyQueueEntry {
  song?: DowntifySong;
  status?: string;
  progress?: number;
  message?: string;
  filename?: string | null;
  [key: string]: unknown;
}

export const downtifySearchSongs = async (query: string): Promise<DowntifySong[]> => {
  return await invoke<DowntifySong[]>("downtify_search_songs", { query });
};

export const downtifyLoadQueue = async (): Promise<DowntifyQueueEntry[]> => {
  return await invoke<DowntifyQueueEntry[]>("downtify_load_queue");
};

export const downtifyQueueDownload = async (song: DowntifySong): Promise<void> => {
  await invoke("downtify_queue_download", { song });
};
