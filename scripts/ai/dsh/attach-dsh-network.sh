#!/usr/bin/env bash
# Attach a running DeepSeek Harness container to the TicketFlow Docker network so
# the harness can reach the MCP endpoint at http://app:5000/api/mcp.
#
# The harness image ships on its own network (dsh-local_default in the DC4 source
# compose); TicketFlow's app sits on ticketflow-main_ticketflow-network. Joining
# the two with docker network connect leaves both containers where they are.
# The script is idempotent: a container already on the network is left alone.
#
# Usage:
#   bash scripts/ai/dsh/attach-dsh-network.sh [harness-container]
#
# Defaults (override with the environment variables of the same name):
#   DSH_CONTAINER=dsh-local
#   TICKETFLOW_NETWORK=ticketflow-main_ticketflow-network
set -euo pipefail

DSH_CONTAINER="${1:-${DSH_CONTAINER:-dsh-local}}"
TICKETFLOW_NETWORK="${TICKETFLOW_NETWORK:-ticketflow-main_ticketflow-network}"

if ! docker network inspect "$TICKETFLOW_NETWORK" >/dev/null 2>&1; then
  echo "TicketFlow network '$TICKETFLOW_NETWORK' not found." >&2
  echo "Start the TicketFlow stack first (docker compose up -d), or set TICKETFLOW_NETWORK to its name." >&2
  exit 1
fi

if ! docker inspect "$DSH_CONTAINER" >/dev/null 2>&1; then
  echo "Harness container '$DSH_CONTAINER' not found. Start it, or pass its name as the first argument." >&2
  exit 1
fi

attached="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$DSH_CONTAINER")"
if printf '%s' "$attached" | grep -qw "$TICKETFLOW_NETWORK"; then
  echo "Already attached: $DSH_CONTAINER is on $TICKETFLOW_NETWORK."
  exit 0
fi

docker network connect "$TICKETFLOW_NETWORK" "$DSH_CONTAINER"
echo "Attached $DSH_CONTAINER to $TICKETFLOW_NETWORK."
echo "In the harness, set TICKETFLOW_MCP_KEY and point the MCP client at http://app:5000/api/mcp."
