import { HardDriveDownload, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { useSoftwareUpdate } from "@/hooks/useSoftwareUpdate";

/**
 * Shell-level "Update available" window — the standard desktop-app update
 * prompt. Polls the daemon's update status and, when a newer Tytus release is
 * available, surfaces a dialog with [Update now] / [Later]. On machines where
 * the daemon can't self-install it shows the one-line install command instead.
 *
 * Mounted once in the App shell; renders nothing when no update is pending.
 */
export default function SoftwareUpdateModal() {
  const { t } = useI18n();
  const { status, visible, installing, installResult, error, install, dismiss } =
    useSoftwareUpdate();

  // Keep the dialog up after the user starts an install so they see the result.
  const open = visible || !!installResult;
  if (!open || !status) return null;

  const version = status.latest_version ?? status.release_tag ?? "";
  const current = status.current_version || status.installed_version;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="software-update-modal">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden="true" />
            <DialogTitle>{t("update.available.title")}</DialogTitle>
          </div>
          <DialogDescription>
            {t("update.available.body", { version })}
          </DialogDescription>
        </DialogHeader>

        {current && (
          <p className="text-sm text-muted-foreground">
            {t("update.available.current", { current })}
          </p>
        )}

        {/* Manual path: daemon can't self-install -> show the command. */}
        {!status.can_install && status.install_command && (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {t("update.available.manualHint")}
            </p>
            <code className="block w-full overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
              {status.install_command}
            </code>
          </div>
        )}

        {installResult && (
          <p className="text-sm text-foreground" role="status">
            {installResult.message}
          </p>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {t("update.available.error")} {error}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={dismiss}
            data-testid="software-update-dismiss"
          >
            {installResult
              ? t("update.available.close")
              : t("update.available.later")}
          </Button>
          {status.can_install && !installResult && (
            <Button onClick={install} disabled={installing}>
              <HardDriveDownload className="size-4" aria-hidden="true" />
              {installing
                ? t("update.available.installing")
                : t("update.available.install")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
