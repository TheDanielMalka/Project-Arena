/**
 * No placeholder company names in-repo. Set VITE_LEGAL_* at deploy time, or show neutral copy.
 */
function envStr(key: string): string {
  const v = (import.meta.env as Record<string, string | undefined>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

export const operatorLegalCopy = {
  governingLaw: envStr("VITE_LEGAL_GOVERNING_LAW") || "To be specified by the platform operator before go-live.",
  arbitrationBody: envStr("VITE_LEGAL_ARBITRATION_BODY") || "To be specified by the platform operator before go-live.",
  arbitrationSeat: envStr("VITE_LEGAL_ARBITRATION_SEAT") || "To be specified by the platform operator before go-live.",
  dataController: envStr("VITE_LEGAL_ENTITY_NAME") || "To be specified by the platform operator before go-live.",
  registeredAddress: envStr("VITE_LEGAL_REGISTERED_ADDRESS") || "To be specified by the platform operator before go-live.",
  dpoDetails: envStr("VITE_LEGAL_DPO_DETAILS") || "Not appointed / to be specified by the platform operator.",
  dpoContact: envStr("VITE_LEGAL_DPO_CONTACT") || "Use the privacy contact below until a DPO is appointed.",
};
