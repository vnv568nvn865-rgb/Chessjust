# Chessjust Native Android foundation

This is the first native UI foundation for the planned Kotlin + Jetpack Compose migration.

Design goals:
- No technical engine/WASM/WebView text in the user-facing UI.
- No forced welcome sentence.
- Dark charcoal/navy visual identity instead of the previous brown-heavy web palette.
- Native bottom navigation and reusable cards.
- Existing web training remains untouched while the native shell is developed in parallel.

Next migration stages: native chessboard -> training screens -> Stockfish bridge -> persistence -> remove WebView dependency.
