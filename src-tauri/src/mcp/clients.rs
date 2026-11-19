//! Authenticated panes that have successfully reached MCP tool discovery.
//! Entries last for one PTY generation and are removed with that session.

use std::collections::HashSet;

/// Per-process session bearer tokens an MCP client has
/// called in with. Entries die with the PTY — see `forget`.
#[derive(Debug, Default)]
pub struct McpClients {
    discovered: HashSet<String>,
}

impl McpClients {
    /// Returns true when a non-empty credential discovers tools for the first time.
    pub fn mark_tools_discovered(&mut self, token: &str) -> bool {
        let token = token.trim();
        !token.is_empty() && self.discovered.insert(token.to_owned())
    }

    pub fn has_discovered_tools(&self, token: &str) -> bool {
        self.discovered.contains(token.trim())
    }

    /// Drop a pane's footprint. Called when a matching session leaves
    /// `AppState.terminals`, so a same-id respawn starts from "no client yet"
    /// instead of inheriting the previous shell's verdict.
    pub fn forget(&mut self, token: &str) {
        self.discovered.remove(token.trim());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_token_has_not_been_seen() {
        let c = McpClients::default();
        assert!(!c.has_discovered_tools("abc-123"));
    }

    #[test]
    fn discovery_marks_the_token_seen() {
        let mut c = McpClients::default();
        c.mark_tools_discovered("abc-123");
        assert!(c.has_discovered_tools("abc-123"));
    }

    #[test]
    fn discovery_is_idempotent() {
        let mut c = McpClients::default();
        assert!(c.mark_tools_discovered("abc-123"));
        assert!(!c.mark_tools_discovered("abc-123"));
        assert!(c.has_discovered_tools("abc-123"));
    }

    #[test]
    fn discovery_ignores_a_blank_token() {
        let mut c = McpClients::default();
        c.mark_tools_discovered("");
        c.mark_tools_discovered("   ");
        assert!(!c.has_discovered_tools(""));
        assert!(!c.has_discovered_tools("   "));
    }

    #[test]
    fn discovery_trims_bearer_whitespace() {
        let mut c = McpClients::default();
        c.mark_tools_discovered("  abc-123  ");
        assert!(c.has_discovered_tools("abc-123"));
    }

    #[test]
    fn forget_drops_the_entry_so_a_respawn_starts_clean() {
        let mut c = McpClients::default();
        c.mark_tools_discovered("abc-123");
        c.forget("abc-123");
        assert!(!c.has_discovered_tools("abc-123"));
    }

    #[test]
    fn forget_is_idempotent() {
        let mut c = McpClients::default();
        c.forget("never-existed");
        assert!(!c.has_discovered_tools("never-existed"));
    }
}
