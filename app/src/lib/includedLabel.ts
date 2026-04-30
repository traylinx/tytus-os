import type { IncludedPod } from "@/types/daemon";

/**
 * Display label for an included (AIL) pod. Hides the daemon-level pod_id
 * because AIL is conceptually a single gateway, not a numbered slot. When
 * an account holds multiple included pods (multi-account / future multi-
 * gateway), disambiguate with the pod_id suffix.
 */
export const includedLabel = (
  pod: Pick<IncludedPod, "pod_id">,
  allIncluded: ReadonlyArray<Pick<IncludedPod, "pod_id">>,
): string => (allIncluded.length <= 1 ? "AIL" : `AIL (${pod.pod_id})`);
