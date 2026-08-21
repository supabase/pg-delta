---
"@supabase/pg-delta": patch
---

Shadow-load assist warnings name the stuck file:line, the statement to move (or a suggested loadOrder), and session-setting statements that poisoned the connection. The same text is emitted through `onWarning` and `loadDiagnostics`.
