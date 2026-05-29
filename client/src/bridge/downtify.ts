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

export const downtifySearchSongs = async (query: string): Promise<DowntifySong[]> => {
  return await invoke<DowntifySong[]>("downtify_search_songs", { query });
};

export const downtifyQueueDownload = async (song: DowntifySong): Promise<void> => {
  await invoke("downtify_queue_download", { song });
};
