import type { Brief } from "../brief/types.ts";
import type { CampaignStore } from "../campaign/store.ts";
import type { Listing } from "../campaign/types.ts";
import { buildExportTable, tableToCsv } from "../export/csv.ts";
import {
  scoreListing,
  selectFacts,
  type Fact,
  type ScoreResult,
} from "../scoring/score.ts";

export interface ScoredItem {
  listing: Listing;
  facts: Map<string, Fact>;
  result: ScoreResult;
}

export interface CampaignScores {
  items: ScoredItem[];
  csv: string;
  hardPass: number;
  withGaps: number;
}

export function scoreCampaign(
  store: CampaignStore,
  brief: Brief,
): CampaignScores {
  const items: ScoredItem[] = store.listListings().map((listing) => {
    const facts = selectFacts(store.listEvidence(listing.id));
    return { listing, facts, result: scoreListing(brief, facts) };
  });

  return {
    items,
    csv: tableToCsv(buildExportTable(items, brief)),
    hardPass: items.filter((item) => item.result.hardPass).length,
    withGaps: items.filter((item) => item.result.gaps.length > 0).length,
  };
}

export function persistScores(
  store: CampaignStore,
  briefVersionId: number,
  items: ScoredItem[],
): void {
  for (const item of items) {
    store.saveScore({
      listingId: item.listing.id,
      briefVersionId,
      score: item.result.score,
      coverage: item.result.coverage,
      hardPass: item.result.hardPass,
      breakdown: {
        breakdown: item.result.breakdown,
        gaps: item.result.gaps,
        questions: item.result.questions,
        hardFailures: item.result.hardFailures,
        notes: item.result.notes,
      },
    });
  }
}
