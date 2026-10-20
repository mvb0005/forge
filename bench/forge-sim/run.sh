#!/usr/bin/env bash
# Plays every pod in $MATCHUPS from turn 1, then every scenario in $SCENARIOS from its saved board.
# One JVM per line, GAMES_PER_RUN seeded games each. The seed goes up by one per line,
# so a given (SEED, round) always replays the same games.
set -uo pipefail

MATCHUPS=${MATCHUPS:-/bench/matchups.txt}
SCENARIOS=${SCENARIOS:-/bench/scenarios.txt}
STATE_DIR=${STATE_DIR:-/bench/states}
FORMAT=${FORMAT:-commander}
DECK_DIR=${DECK_DIR:-/opt/forge-gui/res/quest/commanderprecons}
GAMES_PER_RUN=${GAMES_PER_RUN:-3}
GAME_TIMEOUT=${GAME_TIMEOUT:-1800}
SEED=${SEED:-1}
ROUNDS=${ROUNDS:-0} # 0 = loop forever

sim() {
    java $JAVA_OPTS -javaagent:/opt/otel/opentelemetry-javaagent.jar -jar forge.jar \
        sim -f "$FORMAT" -n "$GAMES_PER_RUN" -s "$SEED" -c "$GAME_TIMEOUT" -q "$@"
    SEED=$((SEED + 1))
}

round=0
while :; do
    round=$((round + 1))
    while IFS='|' read -r -a decks; do
        [[ ${#decks[@]} -eq 0 || "${decks[0]}" == \#* ]] && continue
        echo "round $round seed $SEED: ${decks[*]}"
        sim -D "$DECK_DIR" -d "${decks[@]}"
    done < "$MATCHUPS"
    if [[ -f "$SCENARIOS" ]]; then
        while read -r state; do
            [[ -z "${state// }" || "$state" == \#* ]] && continue
            echo "round $round seed $SEED: scenario $state"
            sim -state "$STATE_DIR/$state"
        done < "$SCENARIOS"
    fi
    if [[ "$ROUNDS" -ne 0 && "$round" -ge "$ROUNDS" ]]; then
        break
    fi
done
