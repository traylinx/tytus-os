import { getFileAssociation } from "@/hooks/useFileSystem";
import type { ContextMenuItem } from "@/types";

const OPEN_WITH_VIEWERS: ReadonlyArray<{
  appId: string;
  label: string;
  icon: string;
}> = [
  { appId: "imageviewer", label: "Open with Image Viewer", icon: "Image" },
  { appId: "documentviewer", label: "Open with Document Viewer", icon: "File" },
  {
    appId: "archivemanager",
    label: "Open with Archive Manager",
    icon: "Package",
  },
];

export const buildFileOpenWithMenu = (
  filename: string,
): ContextMenuItem[] | null => {
  const assoc = getFileAssociation(filename);
  if (!assoc) return null;
  if (!OPEN_WITH_VIEWERS.some((v) => v.appId === assoc.appId)) return null;
  return [
    {
      id: "open-with-default",
      label: OPEN_WITH_VIEWERS.find((v) => v.appId === assoc.appId)!.label,
      icon: OPEN_WITH_VIEWERS.find((v) => v.appId === assoc.appId)!.icon,
      action: `OPEN_APP_WITH_FILE:${assoc.appId}`,
    },
  ];
};

export const inboxLineToFilename = (line: string): string => {
  const trimmed = line.trim();
  if (!trimmed) return "";
  // Take the first whitespace-separated token. `ls -l` output starts with
  // mode bits, so prefer the LAST token if it contains a `.` and the line
  // has multiple tokens — that's the filename in `ls -l`. Bare `ls` output
  // is single-token, so the first-token branch covers that.
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  if (last.includes(".")) return last;
  return parts[0];
};

export const isMissingInboxDiagnostic = (line: string): boolean =>
  /no such file|cannot access .*inbox|not found|missing.*inbox/i.test(line);
