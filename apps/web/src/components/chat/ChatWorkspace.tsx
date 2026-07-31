import type { PaneSourceType } from "../../state/store";
import { ChatDrawer } from "./ChatDrawer";
import { ChatPanel } from "./ChatPanel";

/**
 * The single entry point App.tsx lazy-loads (plan/chat/m9.2-workspace-and-provider.md §11):
 * combining the drawer shell and its content behind one boundary means the whole chat/
 * module tree — client, credentials, providers, errors, sse, settings — loads together,
 * only once Assistant is actually opened, and never as a side effect of opening Search.
 */
export function ChatWorkspace({
  open,
  fullscreen,
  width,
  onWidthChange,
  onClose,
  onCitationNavigate,
}: {
  open: boolean;
  fullscreen: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onCitationNavigate?: (paneType: PaneSourceType | null) => void;
}) {
  return (
    <ChatDrawer
      open={open}
      fullscreen={fullscreen}
      width={width}
      onWidthChange={onWidthChange}
      onClose={onClose}
    >
      <ChatPanel onClose={onClose} onCitationNavigate={onCitationNavigate} />
    </ChatDrawer>
  );
}
