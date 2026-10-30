import type { CompanyInfo } from "@/lib/types";

/** Props every section receives. Sections report what they show via onContext (sent to the AI analyst). */
export interface SectionProps {
  symbol: string;
  info: CompanyInfo | null;
  onContext: (filters: Record<string, unknown>, visible: Record<string, unknown>) => void;
  ask: (question: string) => void;
}
