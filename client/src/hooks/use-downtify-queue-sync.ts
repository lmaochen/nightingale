import { downtifyLoadQueue } from "@/bridge/downtify";
import { ANALYSIS_QUEUE, DOWNTIFY_QUEUE, MENU, SONGS, SONGS_META } from "@/queries/keys";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

function hasActiveDowntifyJobs(queue: unknown[]): boolean {
  return queue.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const status = (entry as { status?: unknown }).status;
    return status === "queued" || status === "downloading";
  });
}

/**
 * Global queue watcher: when Downtify transitions from active downloads to
 * idle, we immediately refresh songs/meta/menu so newly downloaded tracks show
 * up without waiting for the next periodic refresh cycle.
 */
export function useDowntifyQueueSync() {
  const queryClient = useQueryClient();
  const wasActiveRef = useRef(false);

  useQuery({
    queryKey: DOWNTIFY_QUEUE,
    queryFn: downtifyLoadQueue,
    refetchInterval: 2000,
    onSuccess: (queue) => {
      const activeNow = hasActiveDowntifyJobs(queue);
      if (wasActiveRef.current && !activeNow) {
        queryClient.invalidateQueries({ queryKey: SONGS });
        queryClient.invalidateQueries({ queryKey: SONGS_META });
        queryClient.invalidateQueries({ queryKey: MENU });
        queryClient.invalidateQueries({ queryKey: ANALYSIS_QUEUE });
      }
      wasActiveRef.current = activeNow;
    },
  });
}
