import { useCallback, useEffect, useMemo, useState } from "react";

import { listTournamentsByBatchId } from "../services/tournamentsService";

function getCategoryLabel(tournament = {}) {
  return (
    tournament?.compositionLabel ||
    tournament?.compositionConfig?.label ||
    tournament?.name ||
    ""
  );
}

export default function useTournamentCategorySwitcher(tournament, navigation) {
  const tournamentId = tournament?.id || "";
  const batchId = tournament?.creationBatchId || "";
  const [siblings, setSiblings] = useState([]);

  useEffect(() => {
    if (!batchId) {
      setSiblings([]);
      return;
    }

    let isMounted = true;

    listTournamentsByBatchId(batchId)
      .then((results) => {
        if (isMounted) {
          setSiblings(results);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSiblings([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [batchId]);

  const categoryOptions = useMemo(() => {
    if (siblings.length < 2) {
      return [];
    }

    return [...siblings]
      .sort((a, b) => (a.createdAtMillis || 0) - (b.createdAtMillis || 0))
      .map((sibling) => ({ value: sibling.id, label: getCategoryLabel(sibling) }));
  }, [siblings]);

  const onSelectCategory = useCallback(
    (nextTournamentId) => {
      if (nextTournamentId && nextTournamentId !== tournamentId) {
        navigation.setParams({ tournamentId: nextTournamentId });
      }
    },
    [navigation, tournamentId]
  );

  return { categoryOptions, onSelectCategory };
}
