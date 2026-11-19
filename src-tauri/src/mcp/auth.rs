/// Pull the token out of an `Authorization` header value. Tolerates a bare
/// token (no `Bearer ` prefix) because both the MCP client and our own status
/// probe are first-party, and a missing scheme is not worth a 401 of its own —
/// `resolve` still rejects anything that is not a live terminal id.
pub fn bearer(header: &str) -> &str {
    header.strip_prefix("Bearer ").unwrap_or(header)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bearer_strips_the_scheme_prefix() {
        assert_eq!(bearer("Bearer abc-123"), "abc-123");
    }

    #[test]
    fn bearer_passes_through_a_bare_token() {
        assert_eq!(bearer("abc-123"), "abc-123");
    }

    #[test]
    fn bearer_handles_an_empty_header() {
        assert_eq!(bearer(""), "");
    }
}
