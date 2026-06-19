// Canonical Tytus Chat web entry point. Shared by the onboarding card
// (TytusChatCard) and the in-OS Tytus Chat hub (apps/TytusChatHub) so the
// "Open Tytus Chat" action points at one place. The desktop client is a thin
// Electron shell over this same URL (see services/tytus-chat/desktop).
export const TYTUS_CHAT_URL = "https://chat.traylinx.com";
