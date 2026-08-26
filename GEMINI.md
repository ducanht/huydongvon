<!-- CBI-MCP-BEGIN -->
# CODEBASE & SECURITY INTELLIGENCE RULES (CBI-MCP) - huydongvon

CBI-MCP is the primary codebase and security intelligence engine for HuyDongVon.

## Pre-Modification Protocol:
1. Call `cbi_context_packet` or `cbi_context` to generate a token-bounded Evidence Packet.
2. Call `cbi_symbol` and `cbi_search` to locate canonical definitions.
3. Call `cbi_impact` and `cbi_change_risk` to check blast radius.
4. Call `cbi_security_impact` to assess security boundaries (`AUTHENTICATION`, `AUTHORIZATION`, `FINANCIAL_TRANSACTION`).

## Post-Modification Protocol:
1. Call `cbi_diff_impact` to verify changes.
2. Run build (`npm run bundle; npm run build`).
3. Run `cbi security scan` to ensure no security regressions.
<!-- CBI-MCP-END -->