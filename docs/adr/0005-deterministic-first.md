# 0005 – Deterministic first: the LLM curates, code computes

- Status: Accepted
- Date: 2026-11-15

## Context

Free models are slow, scarce (~50 requests/day, [0003](0003-openrouter-free-models-only.md))
and unreliable at arithmetic and geography. An itinerary must still be feasible.

## Decision

The LLM only curates and explains: it suggests attractions, orders and titles days, writes
tips and says what to leave out. Plain code does everything that can be computed:

- distances and travel times (haversine × 1.3; walking ≤ 2 km at 4.5 km/h, otherwise
  transit at 20 km/h + 10 min), clustering into days, schedules and lunch breaks;
- validation of the model's plan, with repair rounds and a rule-based fallback
  ("Planned by rules");
- swipe-learned ranking of the deck (like +1, must-see +2, skip −0.5 per tag/category);
- quick actions, undo, inserting a place into an existing plan, Google Maps links;
- grounding: discovered places without a Wikipedia article with coordinates, or farther than
  30 km from the centre, are dropped.

## Alternatives

- **Let the model plan everything**: fewer lines of code, but infeasible days, invented
  places and one more request for every edit.

## Consequences

- Swiping, editing and undo are instant and free; the app keeps working when the AI budget
  is used up.
- The planner always has a valid answer to fall back on, so a bad model reply never breaks
  the flow.
- Most logic is pure and unit-tested with 100% coverage.
