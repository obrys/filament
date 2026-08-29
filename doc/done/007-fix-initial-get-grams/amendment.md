# Amendment — 007 Fix `InitialNetGrams` of spools

## Completeness assessment

The original report (`README.md`) was judged **complete** — no questions were asked of the user.
It states a concrete scenario (type default 1000 g, spool recorded as 250 g) and names the two
behaviours to verify (populated `InitialNetGrams`, displayed remaining value). The expected
behaviour is independently defined in `doc/spec/domain-rules.md` ("Weight rules"):

- "A new spool's `initialNetGrams` is its requested initial net weight, or the owning type's
  default net weight when omitted."
- "Remaining grams are initialized from `initialNetGrams` and recalculated as that value plus the
  deltas of all enabled events."

## Interpretations (assumptions made by the investigator)

1. "the `filament` table" refers to the `filament_types` table, which holds
   `DefaultNetWeightGrams` (there is no separate `filament` table).
2. "InitialGetGrams" / "sppol" are typos for the spool's `InitialNetGrams` column (spools table).
3. "create a spool" means the UI flow: Spools page → *New spool* form → "Initial net (g, optional)"
   field (the only creation path in the application).
4. "correctly displays the remaining value" covers the two spool displays that show remaining
   grams against the initial net weight: the spool list gauge (`X g / Y`) and the spool detail
   spec line (`Remaining: X g (initial Y g)`).

## Outcome of the investigation

Both reproduction tests pass against the current code — the reported defect **could not be
reproduced** and no discrepancy was found in any code path traced (controller → repository →
persistence → API response → web display), including after recording a print on a spool created
with a custom initial net weight. Per the `investigate-bug` workflow, a passing reproduction test
is a blocker for a specification that claims a proven defect. The companion `specification.md`
therefore documents the *not reproducible* outcome and proposes closing the request with the new
regression tests retained and **no application code change**.

## Open items

- If the reporter still observes a wrong value in their environment, the following information is
  needed to continue: environment (production deployment vs local), the exact type default and the
  exact initial net weight entered, the value shown (screenshot or API response), and the point at
  which the wrong value was seen (creation response, list, detail, or later after prints).
