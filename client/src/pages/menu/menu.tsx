import { ClearCacheDialog } from "@/components/menu/dialogs/clear-cache";
import { DonateDialog } from "@/components/menu/dialogs/donate";
import { EditLyricsDialog } from "@/components/menu/dialogs/edit-lyrics";
import { ExitDialog } from "@/components/menu/dialogs/exit";
import { InfoDialog } from "@/components/menu/dialogs/info";
import { JellyfinConnectDialog } from "@/components/menu/dialogs/remote-source/jellyfin-connect";
import { NavidromeConnectDialog } from "@/components/menu/dialogs/remote-source/navidrome-connect";
import { SelectLanguageDialog } from "@/components/menu/dialogs/language";
import { CreateProfileDialog } from "@/components/menu/dialogs/profile/create";
import { ReanalyzeAllDialog } from "@/components/menu/dialogs/reanalyze-all";
import { RequestSongDialog } from "@/components/menu/dialogs/request-song";
import { SelectProfileDialog } from "@/components/menu/dialogs/profile/select";
import { SettingsDialog } from "@/components/menu/dialogs/settings";
import { UpdateDialog } from "@/components/menu/dialogs/update";
import { Sidebar } from "@/components/menu/sidebar/sidebar";
import { EmptySongList } from "@/components/menu/song-list/empty-song-list";
import { SongList } from "@/components/menu/song-list/song-list";
import { Button } from "@/components/ui/button";
import { SidebarInset } from "@/components/ui/sidebar";
import { EXIT_SUPPORTED } from "@/bridge/exit";
import { useMenuNav } from "@/hooks/navigation/use-menu-nav";
import { useDialog } from "@/hooks/use-dialog";
import { useShouldRunSetup } from "@/hooks/use-should-run-setup";
import { useSongsMeta } from "@/queries/use-songs";
import { ReactElement, useCallback } from "react";
import { useNavigate } from "react-router";

export const Menu = () => {
  const { data: meta, isLoading: isLoadingMeta } = useSongsMeta();
  const { mode, setMode } = useDialog();
  const { shouldRunSetup } = useShouldRunSetup();
  const navigate = useNavigate();

  const overlayOpen = mode !== null || shouldRunSetup;

  const onBack = useCallback(() => {
    setMode((prev) => {
      if (prev === null) {
        // Web mode has no app to exit; swallow the back input rather than
        // surfacing a dialog whose confirm action can't do anything useful.
        return EXIT_SUPPORTED ? "exit" : null;
      }

      if (prev === "exit") {
        return null;
      }

      return prev;
    });
  }, [setMode]);

  useMenuNav({ overlayOpen, onBack });

  let content: ReactElement | null = <EmptySongList />;

  if (meta?.folder) {
    content = <SongList />;
  }

  if (isLoadingMeta) {
    content = null;
  }

  return (
    <Sidebar>
      {EXIT_SUPPORTED && <ExitDialog />}
      <SettingsDialog />
      <RequestSongDialog />
      <CreateProfileDialog />
      <SelectProfileDialog />
      <InfoDialog />
      <UpdateDialog />
      <DonateDialog />
      <SelectLanguageDialog />
      <EditLyricsDialog />
      <ClearCacheDialog />
      <ReanalyzeAllDialog />
      <JellyfinConnectDialog />
      <NavidromeConnectDialog />
      <SidebarInset className="overflow-y-auto overscroll-y-contain touch-pan-y">
        <div className="min-h-full pb-24 md:pb-0">{content}</div>
      </SidebarInset>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-3xl grid-cols-4 gap-2">
          <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/")}>
            Library
          </Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => setMode("request-song")}>
            Add Songs
          </Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/join")}>
            Join
          </Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/host")}>
            Host
          </Button>
        </div>
      </div>
    </Sidebar>
  );
};
