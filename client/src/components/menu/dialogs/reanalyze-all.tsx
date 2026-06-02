import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDialogNav } from "@/hooks/navigation/use-dialog-nav";
import { useAnalysis } from "@/hooks/use-analysis";
import { useDialog } from "@/hooks/use-dialog";
import { cn } from "@/lib/utils";
import { useCallback } from "react";

const RING = "ring-2 ring-primary";
const NO_FOCUS_RING = "focus-visible:ring-0 focus-visible:border-transparent";

export const ReanalyzeAllDialog = () => {
  const { close, mode } = useDialog();
  const { reanalyzeAll } = useAnalysis();

  const open = mode === "reanalyze-all";

  const runReanalyze = useCallback(() => {
    reanalyzeAll(true);
    close();
  }, [reanalyzeAll, close]);

  const onConfirm = useCallback(
    (index: number) => {
      if (index === 0) {
        close();
      } else {
        runReanalyze();
      }
    },
    [close, runReanalyze],
  );

  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 2,
    onConfirm,
    onBack: close,
  });

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Re-analyze all songs?</AlertDialogTitle>
          <AlertDialogDescription>
            This will delete the existing analysis (including separated stems) for every song
            matching the current filters and run the full analysis pipeline again from scratch. This
            can take a long time and any manual key or tempo adjustments will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={close}
            className={cn(NO_FOCUS_RING, open && focusedIndex === 0 && RING)}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={runReanalyze}
            className={cn(NO_FOCUS_RING, open && focusedIndex === 1 && RING)}
          >
            Re-analyze all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
